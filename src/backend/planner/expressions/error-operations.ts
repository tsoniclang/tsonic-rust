import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type {
  RustFlowReadProjectionFact,
  RustTargetOperationFact,
} from "../../../analysis/facts/keys.js";
import { isRustProgramErrorCarrier, rustJsErrorTargetType } from "../../../target-model/types/index.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier } from "../../../target-model/types/carriers/source-error.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";
import {
  resolveRustProgramErrorRoute,
  type RustProgramErrorRoute,
} from "../program/source-package-errors.js";

type RustProgramErrorTypeTestFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "program-error-type-test" }
>;

type RustProgramErrorFlowReadFact = Extract<
  RustFlowReadProjectionFact,
  { readonly kind: "program-error-variant" }
>;

export function planRustProgramErrorEquality(
  node: Node,
  left: RustExpr,
  right: RustExpr,
  fact: Extract<RustTargetOperationFact, { readonly kind: "program-error-equality" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const builtin = fact.comparison.kind === "builtin";
  const route = fact.comparison.kind === "project"
    ? resolveProgramErrorFactRoute(fact.sourceCarrier, fact.targetCarrier, fact.comparison.variant, context)
    : undefined;
  if (builtin ? (!isRustProgramErrorCarrier(fact.sourceCarrier) && !isRustSourceErrorCarrier(fact.sourceCarrier)) ||
    (!rustTargetTypeRefEquals(fact.targetCarrier, rustJsErrorTargetType()) &&
      !isRustMutableJsErrorCarrier(fact.targetCarrier) && !isRustSourceErrorCarrier(fact.targetCarrier)) : route === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.program-error-equality",
      "Program-error equality conflicts with its exact closed error variant.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const valueName = allocateRustSyntheticName(names, "error_value");
  const otherName = allocateRustSyntheticName(names, "compared_value");
  const errorPattern: RustPattern = builtin
    ? { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: valueName }] }
    : programErrorPattern(route!, { kind: "binding", name: valueName }, isRustSourceErrorCarrier(fact.sourceCarrier));
  const otherPattern: RustPattern = { kind: "binding", name: otherName };
  const operand = (expression: RustExpr, side: "left" | "right"): RustExpr => {
    const source = side === "left" ? BinaryExpression_Left(context.input.program.source.ast, node)
      : BinaryExpression_Right(context.input.program.source.ast, node);
    const value = source === undefined ? expression : planRustNonConsumingValue(source, expression, context);
    if (fact.errorOperand === side) {
      if (builtin) return isRustSourceErrorCarrier(fact.sourceCarrier)
        ? { kind: "call", path: "Some", args: [{ kind: "reference", expr: value }] }
        : { kind: "method-call", receiver: value, method: "source_error", args: [] };
      return programErrorSubject(value, fact.sourceCarrier, false);
    }
    return { kind: "reference", expr: value };
  };
  return {
    kind: "match",
    expression: { kind: "tuple-literal", elements: [
      operand(left, "left"),
      operand(right, "right"),
    ] },
    arms: [
      {
        pattern: { kind: "tuple", elements: fact.errorOperand === "left"
          ? [errorPattern, otherPattern] : [otherPattern, errorPattern] },
        expression: builtin ? {
          kind: "binary", operator: fact.negated ? "!=" : "==",
          left: { kind: "call", path: "rt::ErrorObject::error_identity_key", args: [{ kind: "path", path: valueName }] },
          right: { kind: "call", path: "rt::ErrorObject::error_identity_key", args: [{ kind: "path", path: otherName }] },
        } : projectErrorPayload(route!, fact.sourceCarrier, { kind: "path", path: valueName }, false, payload =>
          ({ kind: "binary", left: payload, operator: fact.negated ? "!=" : "==", right: { kind: "path", path: otherName } }),
          { kind: "bool-literal", value: fact.negated }),
      },
      { pattern: { kind: "wildcard" }, expression: { kind: "bool-literal", value: fact.negated } },
    ],
  };
}

export function planRustProgramErrorTypeTest(
  node: Node,
  expression: RustExpr,
  fact: RustProgramErrorTypeTestFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const route = resolveProgramErrorFactRoute(
    fact.sourceCarrier,
    fact.targetCarrier,
    fact.variant,
    context,
  );
  if (route === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.program-error-type-test",
      "Program-error type test conflicts with its exact closed error variant.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  const valueName = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(
    context.input.program.source.ast, node, []), "error_package");
  return { kind: "match", expression: programErrorSubject(expression, fact.sourceCarrier, false), arms: [
    { pattern: programErrorPattern(route, { kind: "binding", name: valueName }, isRustSourceErrorCarrier(fact.sourceCarrier)),
      expression: projectErrorPayload(route, fact.sourceCarrier, { kind: "path", path: valueName }, false,
        () => ({ kind: "bool-literal", value: true }), { kind: "bool-literal", value: false }) },
    { pattern: { kind: "wildcard" }, expression: { kind: "bool-literal", value: false } },
  ] };
}

export function planRustProgramErrorFlowRead(
  node: Node,
  expression: RustExpr,
  fact: RustProgramErrorFlowReadFact,
  context: RustPlanContext,
  ownsValue: boolean,
): RustExpr | undefined {
  const route = resolveProgramErrorFactRoute(
    fact.sourceCarrier,
    fact.selectedCarrier,
    fact.variant,
    context,
  );
  if (route === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.program-error-flow-read",
      "Program-error flow projection conflicts with its exact closed error variant.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  const valueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
    "program_error",
  );
  return {
    kind: "match",
    expression: programErrorSubject(expression, fact.sourceCarrier, ownsValue),
    arms: [
      {
        pattern: programErrorPattern(route, { kind: "binding", name: valueName }, isRustSourceErrorCarrier(fact.sourceCarrier)),
        expression: projectErrorPayload(route, fact.sourceCarrier, { kind: "path", path: valueName }, ownsValue,
          payload => ownsValue ? payload : {
          kind: "method-call",
          receiver: payload,
          method: "clone",
          args: [],
        }, { kind: "unreachable", message: "checked flow selected a different program-error variant" }),
      },
      {
        pattern: { kind: "wildcard" },
        expression: {
          kind: "unreachable",
          message: "checked flow selected a different program-error variant",
        },
      },
    ],
  };
}

function resolveProgramErrorFactRoute(
  sourceCarrier: RustProgramErrorTypeTestFact["sourceCarrier"],
  targetCarrier: RustProgramErrorTypeTestFact["targetCarrier"],
  variant: string,
  context: RustPlanContext,
): RustProgramErrorRoute | undefined {
  const definition = context.input.program.projectTypes.definitionForCarrier(targetCarrier);
  if ((!isRustProgramErrorCarrier(sourceCarrier) && !isRustSourceErrorCarrier(sourceCarrier)) ||
    definition === undefined ||
    context.input.program.projectTypes.programErrorVariant(definition) !== variant ||
    !rustTargetTypeRefEquals(context.input.program.projectTypes.openCarrier(definition), targetCarrier) ||
    isRustSourceErrorCarrier(sourceCarrier) && !context.input.program.projectTypes.sourceErrorDefinitions.includes(definition)) {
    return undefined;
  }
  return resolveRustProgramErrorRoute(
    context.sourcePackageErrors,
    context.sourcePackageComponentId,
    definition,
    variant,
  );
}

function programErrorPattern(
  route: RustProgramErrorRoute,
  payload: RustPattern,
  admitted: boolean,
): RustPattern {
  if (route.kind === "local") {
    return {
      kind: "tuple-variant",
      path: `rt::ErrorTransport::${route.variant}`,
      elements: [payload],
    };
  }
  return {
    kind: "tuple-variant",
    path: `rt::ErrorTransport::${route.consumerVariant}`,
    elements: admitted ? [payload] : [{
      kind: "tuple-variant",
      path: `${route.ownerTypePath}::${route.ownerVariant}`,
      elements: [payload],
    }],
  };
}

function programErrorSubject(expression: RustExpr, carrier: TargetTypeRef, owned: boolean): RustExpr {
  return isRustSourceErrorCarrier(carrier) ? { kind: "method-call", receiver: expression,
    method: owned ? "into_admitted_transport" : "as_transport", args: [] }
    : owned ? expression : { kind: "reference", expr: expression };
}

function projectErrorPayload(
  route: RustProgramErrorRoute, carrier: TargetTypeRef, value: RustExpr, owned: boolean,
  project: (payload: RustExpr) => RustExpr, otherwise: RustExpr,
): RustExpr {
  if (route.kind === "local" || !isRustSourceErrorCarrier(carrier)) return project(value);
  return { kind: "match", expression: programErrorSubject(value, carrier, owned), arms: [
    { pattern: { kind: "tuple-variant", path: `${route.ownerTypePath.slice(0, -"TsonicError".length)}ErrorTransport::${route.ownerVariant}`,
      elements: [{ kind: "binding", name: "error_payload" }] }, expression: project({ kind: "path", path: "error_payload" }) },
    { pattern: { kind: "wildcard" }, expression: otherwise },
  ] };
}

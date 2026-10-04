import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type {
  RustFlowReadProjectionFact,
  RustTargetOperationFact,
} from "../../../analysis/facts/keys.js";
import { isRustProgramErrorCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { isRustSourceErrorCarrier, isRustRetainedErrorCarrier } from "../../../target-model/types/carriers/source-error.js";
import { rustCarrierProvidesErrorObservation } from "../../../target-model/types/carriers/error-protocols.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput, rustCurrentErrorBoundary } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";
import {
  resolveRustProgramErrorRoute,
  type RustProgramErrorRoute,
} from "../program/source-package-errors.js";
import { checkedProjectProjectionResultType, planCheckedProjectProjectionCall } from "../objects/checked-project-projections.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustValueBlock } from "../../target-ast/value-block.js";

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
  if (builtin ? (!isRustProgramErrorCarrier(fact.sourceCarrier) && !isRustSourceErrorCarrier(fact.sourceCarrier) &&
      !isRustRetainedErrorCarrier(fact.sourceCarrier)) ||
    !rustCarrierProvidesErrorObservation(fact.targetCarrier, context.input.program.typeDefinitions) : route === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.program-error-equality",
      "Program-error equality conflicts with its exact closed error variant.",
    ));
    return undefined;
  }
  const boundary = isRustProgramErrorCarrier(fact.sourceCarrier) ? rustCurrentErrorBoundary(context) : undefined;
  if (isRustProgramErrorCarrier(fact.sourceCarrier) && boundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.program-error-equality", "Program-error equality requires its exact native error domain."));
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
      if (builtin) {
        const observed = isRustSourceErrorCarrier(fact.sourceCarrier) || isRustRetainedErrorCarrier(fact.sourceCarrier);
        const source: RustExpr = observed
          ? { kind: "reference", expr: value }
          : { kind: "method-call", receiver: value, method: "source_error", args: [] };
        return observed || boundary?.errorDomain === "runtime"
          ? { kind: "call", path: "Some", args: [source] } : source;
      }
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
  const element = rustOptionElementCarrier(fact.sourceCarrier);
  if (element !== undefined) {
    const name = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(
      context.input.program.source.ast, node, []), "optional_error");
    const selected = planRustProgramErrorTypeTest(node, { kind: "path", path: name }, { ...fact, sourceCarrier: element }, context);
    return selected === undefined ? undefined : { kind: "method-call",
      receiver: { kind: "method-call", receiver: expression, method: "as_ref", args: [] }, method: "is_some_and",
      args: [{ kind: "closure", params: [{ name, byRefCopy: false }], body: selected }] };
  }
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
  const projection = (value: RustExpr): RustExpr | undefined => {
    const selected = planCheckedErrorDispatch(value, fact.targetCarrier, context, false);
    return selected === undefined ? undefined : { kind: "option-presence", receiver: selected, present: true };
  };
  if (isRustRetainedErrorCarrier(fact.sourceCarrier)) return projection(expression);
  const otherName = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(
    context.input.program.source.ast, node, []), "retained_error");
  const otherwise = projection({ kind: "path", path: otherName });
  if (otherwise === undefined) return undefined;
  if (route.kind === "local") {
    return { kind: "match", expression: programErrorSubject(expression, fact.sourceCarrier, false), arms: [
      { pattern: programErrorPattern(route, { kind: "wildcard" }, isRustSourceErrorCarrier(fact.sourceCarrier)),
        expression: { kind: "bool-literal", value: true } },
      { pattern: { kind: "binding", name: otherName }, expression: otherwise },
    ] };
  }
  const valueName = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(
    context.input.program.source.ast, node, []), "error_package");
  const externalFallback = projection({ kind: "path", path: valueName });
  if (externalFallback === undefined) return undefined;
  return { kind: "match", expression: programErrorSubject(expression, fact.sourceCarrier, false), arms: [
    { pattern: programErrorPattern(route, { kind: "binding", name: valueName }, isRustSourceErrorCarrier(fact.sourceCarrier)),
      expression: projectErrorPayload(route, fact.sourceCarrier, { kind: "path", path: valueName }, false,
        { kind: "bool-literal", value: true }, externalFallback) },
    { pattern: { kind: "binding", name: otherName }, expression: otherwise },
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
  const recovered = (value: RustExpr): RustExpr | undefined => {
    const projected = planCheckedErrorDispatch(value, fact.selectedCarrier, context, ownsValue);
    const type = rustTypeFromCarrierInContext(fact.selectedCarrier, context);
    if (projected === undefined || type?.kind !== "named") return undefined;
    return rustValueBlock([{ name: "error_dispatch", value: { kind: "method-call", receiver: projected,
      method: "expect", args: [{ kind: "str-literal", value: "checked flow selected a different native Error origin" }] } }],
    { kind: "struct-literal", path: type.path, fields: [
      { name: "identity", value: { kind: "method-call", receiver: { kind: "call", path: "rt::ObjectIdentityCarrier::object_identity",
        args: [{ kind: "method-call", receiver: { kind: "path", path: "error_dispatch" }, method: "as_ref", args: [] }] },
        method: "clone", args: [] } },
      { name: "dispatch", value: { kind: "path", path: "error_dispatch" } },
    ] });
  };
  const dispatchCarrier = rustOptionElementCarrier(fact.sourceCarrier) ?? fact.sourceCarrier;
  if (isRustRetainedErrorCarrier(dispatchCarrier)) return recovered(rustOptionElementCarrier(fact.sourceCarrier) === undefined
    ? expression : programErrorSubject(expression, fact.sourceCarrier, ownsValue));
  const otherName = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(
    context.input.program.source.ast, node, []), "retained_error");
  const otherwise = recovered({ kind: "path", path: otherName });
  if (otherwise === undefined) return undefined;
  const valueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
    "program_error",
  );
  const externalFallback = recovered({ kind: "path", path: valueName });
  if (externalFallback === undefined) return undefined;
  return {
    kind: "match",
    expression: programErrorSubject(expression, fact.sourceCarrier, ownsValue),
    arms: [
      {
        pattern: programErrorPattern(route, { kind: "binding", name: valueName }, isRustSourceErrorCarrier(dispatchCarrier)),
        expression: projectErrorPayload(route, fact.sourceCarrier, { kind: "path", path: valueName }, ownsValue,
          payload => ownsValue ? payload : {
          kind: "method-call",
          receiver: payload,
          method: "clone",
          args: [],
        }, externalFallback),
      },
      { pattern: { kind: "binding", name: otherName }, expression: otherwise },
    ],
  };
}

function resolveProgramErrorFactRoute(
  sourceCarrier: RustProgramErrorTypeTestFact["sourceCarrier"],
  targetCarrier: RustProgramErrorTypeTestFact["targetCarrier"],
  variant: string,
  context: RustPlanContext,
): RustProgramErrorRoute | undefined {
  sourceCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  const definition = context.input.program.projectTypes.definitionForCarrier(targetCarrier);
  if ((!isRustProgramErrorCarrier(sourceCarrier) && !isRustSourceErrorCarrier(sourceCarrier) && !isRustRetainedErrorCarrier(sourceCarrier)) ||
    definition === undefined ||
    context.input.program.projectTypes.programErrorVariant(definition) !== variant ||
    !rustTargetTypeRefEquals(context.input.program.projectTypes.openCarrier(definition), targetCarrier) ||
    (isRustSourceErrorCarrier(sourceCarrier) || isRustRetainedErrorCarrier(sourceCarrier)) && !context.input.program.projectTypes.sourceErrorDefinitions.includes(definition)) {
    return undefined;
  }
  return resolveRustProgramErrorRoute(
    context.sourcePackageErrors,
    context.sourcePackageComponentId,
    definition,
    variant,
  );
}

function planCheckedErrorDispatch(
  expression: RustExpr, carrier: TargetTypeRef, context: RustPlanContext, owned: boolean,
): RustExpr | undefined {
  const result = checkedProjectProjectionResultType(carrier, context);
  return result === undefined ? undefined : planCheckedProjectProjectionCall(expression,
    owned ? "into_project_error" : "project_error", result);
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
  const element = rustOptionElementCarrier(carrier);
  if (element !== undefined) {
    expression = { kind: "method-call", receiver: owned ? expression : { kind: "method-call", receiver: expression,
      method: "as_ref", args: [] }, method: "expect", args: [{ kind: "str-literal", value: "checked flow selected an absent Error" }] };
    carrier = element;
  }
  return isRustSourceErrorCarrier(carrier) ? { kind: "method-call", receiver: expression,
    method: owned ? "into_admitted_transport" : "as_transport", args: [] }
    : owned ? expression : { kind: "reference", expr: expression };
}

function projectErrorPayload(
  route: RustProgramErrorRoute, carrier: TargetTypeRef, value: RustExpr, owned: boolean,
  project: RustExpr | ((payload: RustExpr) => RustExpr), otherwise: RustExpr,
): RustExpr {
  carrier = rustOptionElementCarrier(carrier) ?? carrier;
  if (route.kind === "local" || !isRustSourceErrorCarrier(carrier)) return typeof project === "function" ? project(value) : project;
  return { kind: "match", expression: programErrorSubject(value, carrier, owned), arms: [
    { pattern: { kind: "tuple-variant", path: `${route.ownerTypePath.slice(0, -"TsonicError".length)}ErrorTransport::${route.ownerVariant}`,
      elements: [typeof project === "function" ? { kind: "binding", name: "error_payload" } : { kind: "wildcard" }] },
      expression: typeof project === "function" ? project({ kind: "path", path: "error_payload" }) : project },
    { pattern: { kind: "wildcard" }, expression: otherwise },
  ] };
}

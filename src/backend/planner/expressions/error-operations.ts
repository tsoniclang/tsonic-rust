import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type {
  RustFlowReadProjectionFact,
  RustTargetOperationFact,
} from "../../../analysis/facts/keys.js";
import { isRustProgramErrorCarrier } from "../../../target-model/types/index.js";
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
  const route = resolveProgramErrorFactRoute(fact.sourceCarrier, fact.targetCarrier, fact.variant, context);
  if (route === undefined) {
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
  const errorPattern = programErrorPattern(route, { kind: "binding", name: valueName });
  const otherPattern: RustPattern = { kind: "binding", name: otherName };
  return {
    kind: "match",
    expression: { kind: "tuple-literal", elements: [
      { kind: "reference", expr: left },
      { kind: "reference", expr: right },
    ] },
    arms: [
      {
        pattern: { kind: "tuple", elements: fact.errorOperand === "left"
          ? [errorPattern, otherPattern] : [otherPattern, errorPattern] },
        expression: { kind: "binary", left: { kind: "path", path: valueName },
          operator: fact.negated ? "!=" : "==", right: { kind: "path", path: otherName } },
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
  return {
    kind: "matches",
    expression,
    pattern: programErrorPattern(route, { kind: "wildcard" }),
  };
}

export function planRustProgramErrorFlowRead(
  node: Node,
  expression: RustExpr,
  fact: RustProgramErrorFlowReadFact,
  context: RustPlanContext,
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
    expression: { kind: "reference", expr: expression },
    arms: [
      {
        pattern: programErrorPattern(route, { kind: "binding", name: valueName }),
        expression: {
          kind: "method-call",
          receiver: { kind: "path", path: valueName },
          method: "clone",
          args: [],
        },
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
  if (!isRustProgramErrorCarrier(sourceCarrier) ||
    definition === undefined ||
    context.input.program.projectTypes.programErrorVariant(definition) !== variant ||
    !rustTargetTypeRefEquals(context.input.program.projectTypes.openCarrier(definition), targetCarrier)) {
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
): RustPattern {
  if (route.kind === "local") {
    return {
      kind: "tuple-variant",
      path: `rt::TsonicError::${route.variant}`,
      elements: [payload],
    };
  }
  return {
    kind: "tuple-variant",
    path: `rt::TsonicError::${route.consumerVariant}`,
    elements: [{
      kind: "tuple-variant",
      path: `${route.ownerTypePath}::${route.ownerVariant}`,
      elements: [payload],
    }],
  };
}

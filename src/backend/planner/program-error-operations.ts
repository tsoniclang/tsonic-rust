import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type {
  RustFlowReadProjectionFact,
  RustTargetOperationFact,
} from "../../source/rust-facts/keys.js";
import { isRustProgramErrorCarrier } from "../../source/rust-target-types.js";
import type { RustExpr } from "../rust-ast/nodes.js";
import { missingFactDiagnostic } from "./diagnostics.js";
import { diagnosticInput } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "./synthetic-names.js";

type RustProgramErrorTypeTestFact = Extract<
  RustTargetOperationFact,
  { readonly kind: "program-error-type-test" }
>;

type RustProgramErrorFlowReadFact = Extract<
  RustFlowReadProjectionFact,
  { readonly kind: "program-error-variant" }
>;

export function planRustProgramErrorTypeTest(
  node: Node,
  expression: RustExpr,
  fact: RustProgramErrorTypeTestFact,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!programErrorVariantMatches(
    fact.sourceCarrier,
    fact.targetCarrier,
    fact.variant,
    context,
  )) {
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
    pattern: {
      kind: "tuple-variant",
      path: `rt::TsonicError::${fact.variant}`,
      elements: [{ kind: "wildcard" }],
    },
  };
}

export function planRustProgramErrorFlowRead(
  node: Node,
  expression: RustExpr,
  fact: RustProgramErrorFlowReadFact,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!programErrorVariantMatches(
    fact.sourceCarrier,
    fact.selectedCarrier,
    fact.variant,
    context,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.program-error-flow-read",
      "Program-error flow projection conflicts with its exact closed error variant.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  const valueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.ast, node, []),
    "program_error",
  );
  return {
    kind: "match",
    expression,
    arms: [
      {
        pattern: {
          kind: "tuple-variant",
          path: `rt::TsonicError::${fact.variant}`,
          elements: [{ kind: "binding", name: valueName }],
        },
        expression: { kind: "path", path: valueName },
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

function programErrorVariantMatches(
  sourceCarrier: RustProgramErrorTypeTestFact["sourceCarrier"],
  targetCarrier: RustProgramErrorTypeTestFact["targetCarrier"],
  variant: string,
  context: RustPlanContext,
): boolean {
  const definition = context.input.projectTypes.definitionForCarrier(targetCarrier);
  return isRustProgramErrorCarrier(sourceCarrier) &&
    definition !== undefined &&
    context.input.projectTypes.programErrorVariant(definition) === variant &&
    rustTargetTypeRefEquals(context.input.projectTypes.openCarrier(definition), targetCarrier);
}

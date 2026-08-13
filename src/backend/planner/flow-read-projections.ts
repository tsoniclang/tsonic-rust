import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustCarrierSupportsClone,
  rustOptionElementCarrier,
} from "../../source/rust-target-types.js";
import type { RustExpr } from "../rust-ast/nodes.js";
import { missingFactDiagnostic } from "./diagnostics.js";
import { diagnosticInput } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { planRustProjectDowncastValue } from "./project-downcasts.js";

export function planRustFlowSelectedValue(
  operation: Node,
  sourceValue: Node,
  expression: RustExpr,
  selectedCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  const storedCarrier = context.expressionOverrides?.get(sourceValue)?.carrier ??
    context.input.facts.getRuntimeCarrierFact(sourceValue)?.carrier;
  if (storedCarrier !== undefined && rustTargetTypeRefEquals(storedCarrier, selectedCarrier)) {
    return expression;
  }
  const optionalElement = rustOptionElementCarrier(storedCarrier);
  if (optionalElement !== undefined && rustTargetTypeRefEquals(optionalElement, selectedCarrier)) {
    if (!rustCarrierSupportsClone(selectedCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, operation),
        "rust.backend.flow-read-projection-clone",
        "A narrowed optional Rust value requires a selected carrier with a proven non-consuming clone contract.",
      ));
      return undefined;
    }
    return {
      kind: "method-call",
      receiver: {
        kind: "method-call",
        receiver: {
          kind: "method-call",
          receiver: expression,
          method: "as_ref",
          args: [],
        },
        method: "unwrap",
        args: [],
      },
      method: "clone",
      args: [],
    };
  }
  const dispatchCarrier = optionalElement ?? storedCarrier;
  const sourceDefinition = context.input.projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = context.input.projectTypes.definitionForCarrier(selectedCarrier);
  const relationship = sourceDefinition === undefined || targetDefinition === undefined
    ? { kind: "unrelated" as const }
    : context.input.projectTypes.relationship(selectedCarrier, sourceDefinition);
  if (storedCarrier !== undefined && dispatchCarrier !== undefined && sourceDefinition !== undefined &&
    relationship.kind === "related" &&
    rustTargetTypeRefEquals(relationship.targetType, dispatchCarrier) &&
    context.input.projectTypes.downcastRoute(sourceDefinition, selectedCarrier) !== undefined) {
    return planRustProjectDowncastValue(
      operation,
      expression,
      storedCarrier,
      dispatchCarrier,
      selectedCarrier,
      context,
    );
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, operation),
    "rust.backend.flow-read-projection",
    "The stored Rust value cannot be projected to the exact checker-selected flow carrier.",
  ));
  return undefined;
}

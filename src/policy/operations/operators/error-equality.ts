import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustProgramErrorCarrier, rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustCarrierProvidesErrorObservation } from "../../constraints/error-protocols.js";
import { isRustClosedValueCarrier } from "../../../target-model/types/carriers/closed-value-kind.js";

export function selectRustProgramErrorComparison(
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
  negated: boolean,
  definitions: RustTypeDefinitions,
  projects: ReadonlyMap<TargetTypeRef, { readonly variant: string; readonly carrier: TargetTypeRef }>,
): Extract<RustTargetOperationFact, { readonly kind: "program-error-equality" }> | undefined {
  const errorOperand = isRustProgramErrorCarrier(left) ||
    isRustClosedValueCarrier(left) && rustCarrierProvidesErrorObservation(right, definitions) ? "left"
    : isRustProgramErrorCarrier(right) ||
      isRustClosedValueCarrier(right) && rustCarrierProvidesErrorObservation(left, definitions) ? "right"
    : rustCarrierProvidesErrorObservation(left, definitions) ? "left"
    : rustCarrierProvidesErrorObservation(right, definitions) ? "right" : undefined;
  const sourceCarrier = errorOperand === "left" ? left : right;
  const targetCarrier = errorOperand === "left" ? right : left;
  if (errorOperand === undefined || sourceCarrier === undefined || targetCarrier === undefined) return undefined;
  if (rustCarrierProvidesErrorObservation(targetCarrier, definitions)) {
    return Object.freeze({
      kind: "program-error-equality",
      operationId: `tsonic.rust.program-error-equality.builtin.${errorOperand}.${negated ? "different" : "same"}`,
      sourceCarrier, targetCarrier, comparison: { kind: "builtin" as const }, errorOperand, negated,
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
    });
  }
  const project = projects.get(targetCarrier);
  if (project === undefined || !rustTargetTypeRefEquals(project.carrier, targetCarrier)) return undefined;
  const variant = project.variant;
  return Object.freeze({
    kind: "program-error-equality",
    operationId: `tsonic.rust.program-error-equality.${variant}.${errorOperand}.${negated ? "different" : "same"}`,
    sourceCarrier,
    targetCarrier,
    comparison: { kind: "project" as const, variant },
    errorOperand,
    negated,
    resultCarrier: rustSourcePrimitiveTargetType("bool"),
  });
}

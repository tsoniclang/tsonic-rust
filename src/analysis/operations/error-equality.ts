import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  isRustProgramErrorCarrier,
  rustSourcePrimitiveTargetType,
} from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustSourceErrorCarrier, isRustRetainedErrorCarrier } from "../../target-model/types/carriers/source-error.js";
import { rustCarrierProvidesErrorObservation } from "../../target-model/types/carriers/error-protocols.js";

export function selectRustProgramErrorEquality(
  walk: RustFactWalk,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
  negated: boolean,
): Extract<RustTargetOperationFact, { readonly kind: "program-error-equality" }> | undefined {
  const errorOperand = isRustProgramErrorCarrier(left) || isRustSourceErrorCarrier(left) || isRustRetainedErrorCarrier(left) ? "left"
    : isRustProgramErrorCarrier(right) || isRustSourceErrorCarrier(right) || isRustRetainedErrorCarrier(right) ? "right" : undefined;
  const sourceCarrier = errorOperand === "left" ? left : right;
  const targetCarrier = errorOperand === "left" ? right : left;
  if (errorOperand === undefined || sourceCarrier === undefined || targetCarrier === undefined) return undefined;
  if (rustCarrierProvidesErrorObservation(targetCarrier, walk.context.typeDefinitions)) {
    return Object.freeze({
      kind: "program-error-equality",
      operationId: `tsonic.rust.program-error-equality.builtin.${errorOperand}.${negated ? "different" : "same"}`,
      sourceCarrier, targetCarrier, comparison: { kind: "builtin" as const }, errorOperand, negated,
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
    });
  }
  const definition = walk.context.projectTypes.definitionForCarrier(targetCarrier);
  const variant = definition === undefined ? undefined
    : walk.context.projectTypes.programErrorVariant(definition);
  if (definition?.kind !== "class" || variant === undefined ||
    !rustTargetTypeRefEquals(walk.context.projectTypes.openCarrier(definition), targetCarrier)) return undefined;
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

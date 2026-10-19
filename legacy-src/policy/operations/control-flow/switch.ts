import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSwitchComparison } from "../../../target-model/operations/switch.js";
import {
  isRustAbsenceCarrier, isRustBigIntCarrier, isRustBoolCarrier, isRustNumericCarrier,
  isRustStringCarrier, rustOptionElementCarrier, rustSourceTypeCarrierValue,
} from "../../../target-model/types/index.js";
import { selectRustBinaryOperator } from "../operators/rules.js";

export function rustSwitchCarrierSupportsEquality(carrier: TargetTypeRef): boolean {
  const value = rustOptionElementCarrier(carrier) ?? carrier;
  return isRustAbsenceCarrier(value) || isRustNumericCarrier(value) || isRustBigIntCarrier(value) ||
    isRustBoolCarrier(value) || isRustStringCarrier(value) || rustSourceTypeCarrierValue(value)?.shape === "enum";
}

export function selectRustSwitchComparison(left: TargetTypeRef, right: TargetTypeRef): RustSwitchComparison | undefined {
  if (!rustSwitchCarrierSupportsEquality(left) || !rustSwitchCarrierSupportsEquality(right)) return undefined;
  const leftElement = rustOptionElementCarrier(left);
  const rightElement = rustOptionElementCarrier(right);
  const leftAbsent = isRustAbsenceCarrier(left);
  const rightAbsent = isRustAbsenceCarrier(right);
  if (leftAbsent || rightAbsent) {
    if (leftAbsent && rightElement !== undefined) return { kind: "absence", operand: "right" };
    if (rightAbsent && leftElement !== undefined) return { kind: "absence", operand: "left" };
    return { kind: "constant", value: leftAbsent && rightAbsent };
  }
  const operation = selectRustBinaryOperator("===", leftElement ?? left, rightElement ?? right);
  return operation === undefined || operation.kind === "string-concat" ||
    operation.kind === "operator-call" && operation.fallible ? undefined : {
      kind: "native", leftOptional: leftElement !== undefined, rightOptional: rightElement !== undefined, operation,
    };
}

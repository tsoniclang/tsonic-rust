import { isRustIntegerCarrier, isRustSignedNumericCarrier } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustIntegerLiteralValue } from "../../target-ast/integer-comparisons.js";

export function planRustNativeIntegerIdentity(
  operator: string,
  left: RustExpr,
  right: RustExpr,
  resultCarrier: TargetTypeRef,
): RustExpr | undefined {
  if (operator !== "&" || !isRustIntegerCarrier(resultCarrier) || !isRustSignedNumericCarrier(resultCarrier)) return undefined;
  const allBits = (value: RustExpr): boolean => rustIntegerLiteralValue(value) === -1n ||
    value.kind === "unary" && value.operator === "-" && rustIntegerLiteralValue(value.operand) === 1n;
  return allBits(right) ? left : allBits(left) ? right : undefined;
}

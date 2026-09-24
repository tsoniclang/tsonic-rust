import { isRustIntegerCarrier, isRustSignedNumericCarrier } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";

export function planRustNativeIntegerIdentity(
  operator: string,
  left: RustExpr,
  right: RustExpr,
  resultCarrier: TargetTypeRef,
): RustExpr | undefined {
  if (operator !== "&" || !isRustIntegerCarrier(resultCarrier) || !isRustSignedNumericCarrier(resultCarrier)) return undefined;
  const allBits = (value: RustExpr): boolean => value.kind === "int-literal" && /^-1(?:i(?:8|16|32|64|128|size))?$/u.test(value.text) ||
    value.kind === "unary" && value.operator === "-" && value.operand.kind === "int-literal" &&
      /^1(?:i(?:8|16|32|64|128|size))?$/u.test(value.operand.text);
  return allBits(right) ? left : allBits(left) ? right : undefined;
}

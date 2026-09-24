import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { rustExactIntegerConversionMatches, type RustExactIntegerConversion } from "../../../target-model/conversions/exact-integer.js";

export function lowerRustExactIntegerConversion(
  conversion: RustExactIntegerConversion,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!rustExactIntegerConversionMatches(conversion.source, conversion.target, conversion)) return undefined;
  const targetElement = rustOptionElementCarrier(conversion.target);
  const sourceElement = rustOptionElementCarrier(conversion.source);
  const targetType = rustTypeFromCarrierInContext(targetElement ?? conversion.target, context);
  if (targetType === undefined) return undefined;
  const path = targetElement === undefined
    ? "rt::conversions::checked_integer" : "rt::conversions::checked_optional_integer";
  registerAliasFromPath(context, path);
  const input: RustExpr = targetElement !== undefined && sourceElement === undefined
    ? { kind: "call", path: "Some", args: [expression] } : expression;
  return { kind: "call", path,
    genericArguments: [{ kind: "type", type: targetType }], args: [input] };
}

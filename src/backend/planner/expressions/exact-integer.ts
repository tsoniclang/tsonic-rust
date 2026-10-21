import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function lowerRustExactIntegerConversion(
  conversion: Extract<RustValueConversionContract, { readonly lowering: "exact-integer" }>,
  expression: RustExpr, context: RustPlanContext, node: Node,
): RustExpr {
  const targetType = rustTypeFromCarrierInContext(conversion.targetElement, context)
    ?? failRustPlannerInvariant("An admitted exact integer conversion requires its selected native target type.", node);
  const path = conversion.optional ? "rt::conversions::checked_optional_integer" : "rt::conversions::checked_integer";
  registerAliasFromPath(context, path);
  const input: RustExpr = conversion.lift ? { kind: "call", path: "Some", args: [expression] } : expression;
  return { kind: "call", path, genericArguments: [{ kind: "type", type: targetType }], args: [input] };
}

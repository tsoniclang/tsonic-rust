import {
  rustJsStringConcat,
  rustJsStringLiteral,
} from "../../target-ast/expressions.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planRustJsStringLiteral(
  value: string,
  context: RustPlanContext,
): RustExpr {
  context.usedAliases?.add("js_abi");
  return rustJsStringLiteral(value);
}

export function planRustJsStringConcat(
  parts: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr {
  if (parts.length !== 1) {
    context.usedAliases?.add("js_abi");
  }
  return rustJsStringConcat(parts);
}

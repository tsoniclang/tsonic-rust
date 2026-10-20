import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";

export function finishRuntimeCallableExpression(callable: RustExpr,
  captureBindings: readonly { readonly name: string; readonly value: RustExpr }[]): RustExpr {
  return captureBindings.length === 0 ? callable : rustValueBlock(captureBindings, callable);
}

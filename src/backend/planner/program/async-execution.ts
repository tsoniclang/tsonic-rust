import type { RustBinaryHookPlan } from "../../../target-model/records/operations/binary-execution.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";

export function planRustAsyncExecution(
  execution: RustExpr,
  executor: RustBinaryHookPlan | undefined,
  propagate: (execution: RustExpr, executor: Extract<RustBinaryHookPlan, { readonly isFallible: true }>) => RustExpr,
): RustExpr {
  return executor?.isFallible === true
    ? propagate(execution, executor)
    : execution;
}

import type { RustBinaryHookPlan } from "../../../analysis/runtime/hooks.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";

export function planRustAsyncExecution(
  future: RustExpr,
  executor: RustBinaryHookPlan | undefined,
  resultErrorType: RustType,
  providerErrorType: RustType | undefined,
): RustExpr {
  const execution: RustExpr = {
    kind: "call",
    path: executor?.path ?? "tsonic_rust_runtime::block_on",
    args: [future],
  };
  return executor?.isFallible === true
    ? applyRustErrorBoundary(execution, executor.errorBoundary, resultErrorType, providerErrorType)
    : execution;
}

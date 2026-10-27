import type { RustBinaryExecution } from "../../../target-model/records/operations/binary-execution.js";
import type { RustBlock, RustExpr, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustBinaryHookCallPlan } from "./binary-hook-contexts.js";
import type { RustBinaryErrorPlan } from "./binary-errors.js";

export const rustBinaryExitCodeType: RustType = Object.freeze({ kind: "named", path: "std::process::ExitCode" });

export function planRustOwnedBinaryEntry(input: {
  readonly execution: Extract<RustBinaryExecution, { readonly kind: "owned" }>;
  readonly hook: RustBinaryHookCallPlan;
  readonly body: RustBlock;
  readonly afterEntry: readonly RustStmt[];
  readonly errors: RustBinaryErrorPlan;
  readonly fallible: boolean;
  // The owner hook's error type when it is known to equal the lifecycle error type.
  readonly hookErrorType?: RustType;
}): RustBlock {
  const root: RustExpr = input.execution.execution === "entry"
    ? { kind: "closure", params: [], body: { kind: "block", body: input.body } }
    : { kind: "async-block", move: false, body: input.body };
  const call = input.hook.call([root]);
  const state: RustExpr = { kind: "path", path: "entry_completion" };
  const status: RustExpr = { kind: "field", receiver: state, name: "1" };
  const complete = (value: RustExpr): RustExpr => input.fallible
    ? { kind: "call", path: "Ok", args: [value] } : value;
  const rawOutput: RustExpr = { kind: "field", receiver: state, name: "0" };
  const output: RustExpr = input.execution.execution === "entry" ? rawOutput
    : { kind: "method-call", receiver: rawOutput, method: "expect", args: [{ kind: "str-literal",
      value: "The selected entry owner stopped without a completed root or a requested exit." }] };
  return { statements: [
    { kind: "let", name: "entry_completion", mutable: false, init: input.execution.owner.isFallible
      ? input.errors.lifecycle(call, input.hookErrorType) : call },
    { kind: "if", condition: { kind: "method-call", receiver: status, method: "exit_requested", args: [] },
      then: { statements: [{ kind: "return", expr: complete({ kind: "method-call", receiver: status, method: "into", args: [] }) }] } },
    { kind: "expr", expr: input.fallible ? { kind: "try", expr: output,
      operandErrorType: input.errors.errorType, resultErrorType: input.errors.errorType } : output },
    ...input.afterEntry,
    { kind: "tail", expr: complete({ kind: "associated-value", owner: rustBinaryExitCodeType, name: "SUCCESS" }) },
  ] };
}

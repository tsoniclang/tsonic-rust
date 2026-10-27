import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustBinaryHookPlan, RustBinaryExecution } from "../../target-model/records/operations/binary-execution.js";

export function analyzeRustBinaryExecution(input: {
  readonly hooks: readonly RustBinaryHookPlan[];
  readonly outputType: "bin" | "lib";
  readonly jsEnabled: boolean;
  readonly asynchronous: boolean;
}): TargetStageResult<RustBinaryExecution> {
  const executors = input.hooks.filter(hook => hook.phase === "async-execution");
  if (executors.length > 1) return reject("RUST_AMBIGUOUS_ASYNC_EXECUTOR", "An executable requires exactly one active native async executor.");
  if (input.outputType === "lib") return resolvedTargetStage(Object.freeze({ kind: "library" }));
  if (!input.jsEnabled) return resolvedTargetStage(Object.freeze({ kind: "native", executor: executors[0] }));
  const owners = input.hooks.filter(hook => hook.phase === (input.asynchronous ? "async-entry-execution" : "entry-execution"));
  if (owners.length !== 1) return reject(owners.length > 1 ? "RUST_AMBIGUOUS_ENTRY_OWNER" : "RUST_ENTRY_OWNER_NOT_PROVEN",
    "A JS executable requires one exact selected loop owner for its complete entry.");
  return resolvedTargetStage(Object.freeze({ kind: "owned", execution: input.asynchronous ? "future" : "entry", owner: owners[0]! }));
}

function reject(code: string, message: string): TargetStageResult<never> {
  return rejectedTargetStage([{ code, message, category: "error", source: "tsonic-rust",
    evidence: ["target.capability=rust.runtime.binary-entry-owner"] }]);
}

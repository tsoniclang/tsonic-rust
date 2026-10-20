export type RustBinaryHookPhase =
  | "before-initialization"
  | "entry-execution"
  | "async-entry-execution"
  | "async-execution"
  | "after-entry";

export function isRustBinaryHookPhase(value: unknown): value is RustBinaryHookPhase {
  return value === "before-initialization" || value === "entry-execution" ||
    value === "async-entry-execution" || value === "async-execution" || value === "after-entry";
}

export function rustBinaryHookInputCount(phase: RustBinaryHookPhase): 0 | 1 {
  return phase === "entry-execution" || phase === "async-entry-execution" || phase === "async-execution" ? 1 : 0;
}

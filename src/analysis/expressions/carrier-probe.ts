import { createRustProgramRecordBuilder } from "../program/records/create.js";
import type { RustFactWalk } from "../program/walk.js";

export function createRustCarrierProbe(walk: RustFactWalk): RustFactWalk {
  const records = createRustProgramRecordBuilder(walk.context.typeDefinitions, walk.context.records);
  return {
    ...walk,
    context: { ...walk.context, records, diagnostics: [] },
    operationAttempts: new WeakSet(),
    postCheckOperations: new WeakMap(),
    rejectedExpressions: new WeakSet(),
    resolving: new Set(),
  };
}

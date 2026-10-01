import { createRustPlanBuilder } from "../facts/plan-store.js";
import type { RustFactWalk } from "../program/walk.js";

export function createRustCarrierProbe(walk: RustFactWalk): RustFactWalk {
  const facts = createRustPlanBuilder(walk.context.source.sourceFacts, walk.context.typeDefinitions, walk.context.facts);
  return {
    ...walk,
    context: { ...walk.context, facts, diagnostics: [] },
    operationAttempts: new WeakSet(),
    postCheckOperations: new WeakMap(),
    rejectedExpressions: new WeakSet(),
    resolving: new Set(),
  };
}

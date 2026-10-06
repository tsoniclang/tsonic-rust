import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustDispatchContextCatalog } from "../../../dist/analysis/runtime/dispatch-contexts.js";
import { rustBuiltInSourceTypeSemantics } from "../../../dist/providers/builtins/source-types.js";
import { rustJsAsyncExecutor, rustJsEventLoopEpilogue, rustJsTimerDispatchContextId } from "../../../dist/providers/builtins/js-dispatch.js";

test("JS dispatch roots remain immutable, root-only and inactive without their exact native crate", () => {
  const semantics = rustBuiltInSourceTypeSemantics();
  const inactive = analyzeRustDispatchContextCatalog(semantics.dispatchContexts, []);
  assert.equal(inactive.kind, "resolved");
  assert.equal(inactive.plan.declaration(rustJsTimerDispatchContextId) === undefined, true);
  const selected = analyzeRustDispatchContextCatalog(semantics.dispatchContexts, ["tsonic_rust_js"]);
  assert.equal(selected.kind, "resolved");
  const declaration = selected.plan.declaration(rustJsTimerDispatchContextId);
  assert.equal(declaration !== undefined, true, "one selected builtin owner");
  assert.equal(Object.hasOwn(declaration, "handle"), false);
  assert.equal(Object.isFrozen(declaration.rootCarrier), true);
  assert.deepEqual(selected.plan.compose([]).plan.rootContextIds, []);
  assert.deepEqual(selected.plan.compose([rustJsTimerDispatchContextId]).plan.rootContextIds, [rustJsTimerDispatchContextId]);
  for (const hook of [rustJsAsyncExecutor, rustJsEventLoopEpilogue]) {
    assert.equal(hook.errorBoundary, "source-program");
    assert.deepEqual(hook.dispatchGroups[0].contextIds, [rustJsTimerDispatchContextId]);
    assert.equal(hook.dispatchGroups[0].targetArgumentIndex, hook.phase === "async-execution" ? 1 : 0);
    assert.equal(Object.isFrozen(hook.dispatchGroups[0]), true);
  }
});

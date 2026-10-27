import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { contextualAsyncCostSource, contextualAsyncResultSource, inlineContextualAsyncResultSource, ordinaryAsyncResultSource } from "../../../../tsonic/test/fixtures/contextual-async-results.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { assertRejectedAsyncSource, assertSettledCopiedPromise, verifyNativeBorrowedPromiseBoundary }
  from "../../helpers/native-promise-lifetimes.mjs";

test("contextual async output cannot extend a genuinely pending borrowed capture", { timeout: 300_000 }, () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
async function read<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending;
  return load(value);
}
export function escape<Region extends Life>(value: Ref<int32, Region>, previous: Promise<void>): () => Promise<int32 | void> {
  const pending: Promise<int32> = read(value, previous);
  return async () => await pending;
}
` } });
  assertRejectedAsyncSource(compilation, [
    { code: "TSONIC_BORROWED_ASYNC_RESULT_ESCAPES", kind: "KindCallExpression", text: "read(value, previous)" },
    { code: "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", kind: "KindCallExpression", text: "read(value, previous)" },
  ]);
  const control = compileRust({ surfaces: ["js"], files: { "index.ts": ordinaryAsyncResultSource } }).result;
  assert.equal(control.diagnostics.length, 0);
  verifyNativeBorrowedPromiseBoundary("contextual-async-borrow-rejected", control.artifacts, true);
});

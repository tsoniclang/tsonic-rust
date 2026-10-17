import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertRejectedAsyncSource, assertSettledCopiedPromise, verifyNativeBorrowedPromiseBoundary }
  from "../../helpers/native-promise-lifetimes.mjs";

test("retained async callbacks observe mutable Promise storage without lifetime adapters", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
async function failure(): Promise<void> { throw new Error("failed"); }
function create(): () => Promise<string> {
  let processing: Promise<string> = Promise.resolve("initial");
  const finish = async (): Promise<string> => await processing;
  processing = Promise.resolve("retained");
  return finish;
}
async function run(): Promise<boolean> {
  const retained = create();
  if (await retained() !== "retained" || await retained() !== "retained") return false;
  let processing: Promise<void> = Promise.resolve(undefined);
  const complete = async (): Promise<string> => { await processing; return "completed"; };
  if (await complete() !== "completed") return false;
  processing = failure();
  let rejected = false;
  try { await complete(); } catch { rejected = true; }
  processing = Promise.resolve(undefined);
  return rejected && await complete() === "completed";
}
export async function main(): Promise<void> { if (!await run()) throw new Error("retained storage"); }
await main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::Location<js_abi::JsPromise<(?:String|\(\))>, core::convert::Infallible>/u);
  assert.doesNotMatch(source, /transmute|\.then\(|\.then_async\(/u);
  validateGeneratedProject("suspended-capture-storage", result.artifacts, { run: true });
});

test("a settled borrowed read stores its copied payload without extending the input loan", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
async function read<L extends Life>(value: Ref<int32, L>): Promise<int32> { return load(value); }
export function escape<L extends Life>(value: Ref<int32, L>): () => Promise<int32> {
  const processing: Promise<int32> = read(value);
  return async (): Promise<int32> => await processing;
}
export async function main(): Promise<void> {
  const retained = (() => {
    const value = 17 as int32;
    return escape(ref(value));
  })();
  if (await retained() !== 17 || await retained() !== 17) throw new Error("settled copied payload");
}
await main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  assertSettledCopiedPromise(result, "processing");
  assert.equal(validateGeneratedProject("suspended-capture-settled-copy", result.artifacts, { run: true }).status, 0,
    "the exact original eager read and repeated stored completion outlive only the copied value");
});

test("genuinely pending source storage cannot extend its retained input loan", { timeout: 300_000 }, () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
async function read<L extends Life>(value: Ref<int32, L>, pending: Promise<void>): Promise<int32> {
  await pending;
  return load(value);
}
export function escape<L extends Life>(value: Ref<int32, L>, pending: Promise<void>): () => Promise<int32> {
  const processing: Promise<int32> = read(value, pending);
  return async (): Promise<int32> => await processing;
}
` } });
  assertRejectedAsyncSource(compilation, [
    { code: "TSONIC_BORROWED_ASYNC_RESULT_ESCAPES", kind: "KindCallExpression", text: "read(value, pending)" },
    { code: "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", kind: "KindCallExpression", text: "read(value, pending)" },
  ]);
  const control = compileRust({ surfaces: ["js"], files: { "index.ts": `
export async function read(): Promise<number> { return 17; }
` } }).result;
  assertNoTargetDiagnostics(control.diagnostics);
  verifyNativeBorrowedPromiseBoundary("suspended-capture-borrow-rejected", control.artifacts, false);
});

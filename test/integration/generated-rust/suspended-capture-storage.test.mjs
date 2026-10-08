import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { verifyNativeBorrowedPromiseBoundary } from "../../helpers/native-promise-lifetimes.mjs";

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
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::Location<js_abi::JsPromise<'static,/u);
  assert.doesNotMatch(source, /transmute|\.then\(|\.then_async\(/u);
  validateGeneratedProject("suspended-capture-storage", result.artifacts, { run: true });
});

test("inferred owning storage never extends the lifetime of a borrowed Promise", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
async function read<L extends Life>(value: Ref<int32, L>): Promise<int32> { return load(value); }
export function escape<L extends Life>(value: Ref<int32, L>): () => Promise<int32> {
  const processing: Promise<int32> = read(value);
  return async (): Promise<int32> => await processing;
}
` } });
  assert.deepEqual(result.diagnostics.map(row => row.code).sort(), [
    "RUST_FUTURE_VALUE_CARRIER_CONFLICT", "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
    "RUST_FUTURE_VALUE_CARRIER_CONFLICT", "RUST_FUTURE_VALUE_CARRIER_CONFLICT", "RUST_INITIALIZER_CARRIER_MISMATCH",
  ]);
  assert.equal(result.artifacts.length, 0, "invalid lifetime transport publishes no native output");
  const control = compileRust({ surfaces: ["js"], files: { "index.ts": `
export async function read(): Promise<number> { return 17; }
` } }).result;
  assertNoTargetDiagnostics(control.diagnostics);
  verifyNativeBorrowedPromiseBoundary("suspended-capture-borrow-rejected", control.artifacts, false);
});

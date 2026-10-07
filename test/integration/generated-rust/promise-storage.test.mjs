import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("annotated Promise storage preserves values, repeated awaits and rejection", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
class Work {
  completion: Promise<void> = Promise.resolve(undefined);
  value: Promise<string> = Promise.resolve("ready");
  wide: Promise<uint64> = Promise.resolve(wideValue());
  async wait(): Promise<void> { await this.completion; }
  pending(): Promise<void> { return this.completion; }
  fail(): void { this.completion = failure(); }
}
async function failure(): Promise<void> { throw new Error("failed"); }
function wideValue(): uint64 { return 9007199254740993n; }
function retain(value: Promise<void>): void { void value; }
function forward(value: Promise<void>): Promise<void> { return value; }
function create(): Promise<void> { return forward(Promise.resolve(undefined)); }
async function receive(value: Promise<void>): Promise<void> { await value; }
async function run(): Promise<boolean> {
  await Promise.resolve(undefined);
  if (await Promise.resolve("standalone") !== "standalone") return false;
  if (await Promise.resolve(wideValue()) !== wideValue()) return false;
  const completion: Promise<void> = Promise.resolve(undefined);
  retain(completion);
  await receive(forward(completion));
  await create();
  await completion;
  await completion;
  let text: Promise<string> = Promise.resolve("initial");
  if (await text !== "initial") return false;
  text = Promise.resolve("replaced");
  if (await text !== "replaced" || await text !== "replaced") return false;
  const work = new Work();
  await work.wait();
  await work.pending();
  const expected: uint64 = 9007199254740993n;
  if (await work.value !== "ready" || await work.wide !== expected) return false;
  work.fail();
  let failures = 0;
  try { await work.wait(); } catch { failures += 1; }
  try { await work.pending(); } catch { failures += 1; }
  return failures === 2;
}
export async function main(): Promise<void> { if (!await run()) throw new Error("Promise storage"); }
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /\.then\(|\.then_async\(/);
  assert.match(source, /JsPromise<'static, \(\), rt::TsonicError>/);
  validateGeneratedProject("promise-storage", result.artifacts, { run: true });
});

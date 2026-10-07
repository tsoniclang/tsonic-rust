import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("retained async callables bind native input lifetimes without changing capture storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
async function failure(): Promise<void> { throw new Error("failed"); }
async function retained<Value>(value: Value): Promise<Value> {
  const read = async (previous: Promise<void>): Promise<Value> => {
    await previous;
    return value;
  };
  return await read(Promise.resolve(undefined));
}
async function run(): Promise<boolean> {
  if (await retained("generic") !== "generic") return false;
  const prefix = "kept:";
  const continueWith = async (previous: Promise<void>, value: string): Promise<string> => {
    await previous;
    return prefix + value;
  };
  if (await continueWith(Promise.resolve(undefined), "first") !== "kept:first") return false;
  if (await continueWith(Promise.resolve(undefined), "second") !== "kept:second") return false;
  let rejected = false;
  try { await continueWith(failure(), "unused"); } catch { rejected = true; }
  return rejected;
}
export async function main(): Promise<void> { if (!await run()) throw new Error("retained input"); }
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /impl<'input>/u);
  assert.match(source, /impl<'input, Value:/u);
  assert.match(source, /JsPromise<'input, \(\), rt::TsonicError>/u);
  assert.match(source, /JsPromise<'input, String, rt::TsonicError>/u);
  assert.doesNotMatch(source, /transmute|\.then\(|\.then_async\(/u);
  validateGeneratedProject("suspended-input-lifetimes", result.artifacts, { run: true });
});

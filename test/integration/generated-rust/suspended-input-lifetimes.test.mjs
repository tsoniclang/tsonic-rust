import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("retained async callables preserve exact owning inputs without changing capture storage", { timeout: 300_000 }, () => {
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
  assert.equal(/impl<Value: Clone \+ 'static>/u.test(source), true, "owning captured generic payload");
  assert.equal(/JsPromise<'static, \(\), rt::TsonicError>/u.test(source), true, "exact owning input promise");
  assert.equal(/JsPromise<'static, String, rt::TsonicError>/u.test(source), true, "exact owning string result");
  assert.equal(/impl<'input|transmute|\.then\(|\.then_async\(/u.test(source), false,
    "closed owning inputs introduce no fictitious loan or continuation adapter");
  validateGeneratedProject("suspended-input-lifetimes", result.artifacts, { run: true });
});

import { localFiniteAwaitBranches } from "../../../../tsonic/test/fixtures/local-finite-await-branches.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("finite native await branches preserve direct values, wide future values, absence and rejection", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
async function read(value: uint64 | Promise<uint64>): Promise<uint64> { return await value; }
async function optional(value: uint64 | Promise<uint64> | null | undefined): Promise<uint64 | null | undefined> {
  return await value;
}
async function failed(): Promise<uint64> { throw new Error("finite rejection"); }
async function direct(value: uint64): Promise<uint64> { return await value; }
export async function main(): Promise<void> {
  const wide: uint64 = 9007199254740993n;
  if (await direct(wide) !== wide || await read(wide) !== wide || await read(Promise.resolve(wide)) !== wide) {
    throw new Error("native await lost width");
  }
  if (await optional(null) !== undefined || await optional(undefined) !== null ||
    await optional(wide) !== wide || await optional(Promise.resolve(wide)) !== wide) {
    throw new Error("native await lost absence or value");
  }
  let rejected = false;
  try { await read(failed()); } catch { rejected = true; }
  if (!rejected) throw new Error("native await lost rejection");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /match value/u);
  assert.match(source, /into_result\(\)\.await\?/u);
  assert.doesNotMatch(source, /Box::pin|dyn Future|Any|9007199254740993\.0|value\.clone\(\)/u);
  validateGeneratedProject("finite-await", result.artifacts, { run: true });
});

test("local finite await branches execute exact native values, futures and absence", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": localFiniteAwaitBranches } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /match value/u);
  assert.match(source, /into_result\(\)\.await\?/u);
  assert.doesNotMatch(source, /Box::pin|dyn Future|Any|9007199254740993\.0|value\.clone\(\)/u);
  validateGeneratedProject("local-finite-await", result.artifacts, { run: true });
});

for (const surfaces of [ [], ["js"] ]) {
  test(`native synchronous await evaluates its operand once on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
class Counter {
  calls: int32 = 0;
  next(): int32 { this.calls += 1; return this.calls; }
  async verify(): Promise<boolean> { return await this.next() === 1 && this.calls === 1; }
}
export async function main(): Promise<void> {
  const counter = new Counter();
  if (!await counter.verify()) throw new Error("await evaluated its input incorrectly");
}
` } });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactText(result, "src/index.rs");
    assert.doesNotMatch(source, /next\([^)]*\)\.await/u);
    assert.doesNotMatch(source, /Box::pin|dyn Future|Any/u);
    validateGeneratedProject("synchronous-await", result.artifacts, { run: true });
  });
}

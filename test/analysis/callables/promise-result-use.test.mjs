import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";

for (const [name, statement, observations] of [
  ["ordinary discard", "leaf();", 1],
  ["void discard", "void leaf();", 1],
  ["conditional discard", "flag ? leaf() : leaf();", 2],
  ["stored completion", "const pending = leaf(); return await pending;", 0],
  ["direct await", "return await leaf();", 0],
]) {
  test(`Promise result use is selected before planning: ${name}`, () => {
    const { result, program } = compileRust({ surfaces: ["js"], files: { "index.ts": `
      async function leaf(): Promise<number> { return 1; }
      export async function outer(flag: boolean): Promise<number> { ${statement} return 0; }
    ` } });
    assert.deepEqual(result.diagnostics.map(({ code, message }) => `${code}: ${message}`), []);
    assert.equal(program.promiseResults instanceof Map, true);
    assert.equal([...program.promiseResults.values()].filter(row => row.discard !== undefined).length, observations);
    assert.equal((rustSourceText(result).match(/\.observe_discarded\(\)/gu) ?? []).length, observations);
    for (const row of program.promiseResults.values()) assert.equal(Object.isFrozen(row), true);
  });
}

test("native discarded async calls are rejected before program publication", () => {
  let published = false;
  const { result } = compileRust({ files: { "index.ts": `
    async function leaf(): Promise<number> { return 1; }
    export function outer(): void { leaf(); }
  ` }, compileTarget(request) {
    return importAnalysis(request);
  } });
  function importAnalysis(request) {
    const selected = analyzeRustTargetProgram(request);
    published = selected.kind === "resolved";
    return selected.kind === "rejected" ? selected : { kind: "rejected", diagnostics: [] };
  }
  assert.equal(published, false);
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["RUST_DISCARDED_NATIVE_ASYNC_CALL"]);
  assert.equal(result.artifacts.length, 0);
});

import { analyzeRustTargetProgram } from "../../../dist/analysis/program/target-program.js";

test("stored native futures remain admitted and do not gain JS observers", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    async function leaf(): Promise<number> { return 1; }
    export async function outer(): Promise<number> { const pending = leaf(); return await pending; }
  ` } });
  assert.equal([...program.promiseResults.values()].some(row => row.discard !== undefined), false);
  assert.equal([...program.promiseResults.values()].some(row => row.disposition.kind === "stored"), true);
});

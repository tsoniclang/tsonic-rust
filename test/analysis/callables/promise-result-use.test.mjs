import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/target-program.js";

for (const [name, statement, observations] of [
  ["ordinary discard", "leaf();", 1],
  ["void discard", "void leaf();", 1],
  ["conditional discard", "flag ? leaf() : leaf();", 2],
  ["stored completion", "const pending = leaf(); return await pending;", 0],
  ["direct await", "return await leaf();", 0],
  ["discarded reaction", "leaf().then(value => value + 1);", 1],
]) {
  test(`Promise result use is selected before planning: ${name}`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
      async function leaf(): Promise<number> { return 1; }
      export async function outer(flag: boolean): Promise<number> { ${statement} return 0; }
    ` } });
    assert.deepEqual(result.diagnostics.map(({ code, message }) => `${code}: ${message}`), []);
    const { program } = result;
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
    const selected = analyzeRustTargetProgram(request);
    published = selected.kind === "resolved";
    return selected.kind === "rejected" ? selected : { kind: "rejected", diagnostics: [] };
  } });
  assert.equal(published, false);
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["TSONIC_NATIVE_ASYNC_RESULT_DISCARDED"]);
  assert.equal(result.artifacts.length, 0);
});

test("stored native futures remain admitted and do not gain JS observers", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    async function leaf(): Promise<number> { return 1; }
    export function outer(): void { const pending = leaf(); }
  ` } });
  assert.equal([...program.promiseResults.values()].some(row => row.discard !== undefined), false);
  assert.equal([...program.promiseResults.values()].some(row => row.disposition.kind === "stored"), true);
});

for (const [name, result, branch, shape] of [
  ["optional", "Promise<number> | undefined", "undefined", "optional"],
  ["union", "Promise<number> | number", "3", "union"],
]) {
  test(`discarded ${name} completion renders its preselected branch topology`, () => {
    const { result: compiled } = compileRust({ surfaces: ["js"], files: { "index.ts": `
      async function leaf(): Promise<number> { return 1; }
      function choose(flag: boolean): ${result} { return flag ? leaf() : ${branch}; }
      export function run(flag: boolean): void { choose(flag); }
    ` } });
    assert.deepEqual(compiled.diagnostics.map(({ code, message }) => `${code}: ${message}`), []);
    const rows = [...compiled.program.promiseResults.values()].filter(row => row.discard !== undefined);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].discard.kind, shape);
    const emitted = rustSourceText(compiled);
    assert.equal((emitted.match(/\.observe_discarded\(\)/gu) ?? []).length, 1, emitted);
    assert.equal((emitted.match(/choose\(flag\)/gu) ?? []).length, 1, emitted);
  });
}

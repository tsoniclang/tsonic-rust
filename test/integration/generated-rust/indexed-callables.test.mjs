import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { indexedCallableSource } from "../../../../tsonic/test/fixtures/indexed-callables.mjs";

test("indexed callables retain exact presence, evaluation order and shared mutation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": indexedCallableSource + '\nexport function main(): void { if (!run()) throw new Error("indexed callable identity and order"); }',
    } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /\.get_number\([^\n]*\)\.call/u);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /\.get_number\([^\n]*\)\.as_ref\(\)/u);
  validateGeneratedProject("indexed-callables", result.artifacts, { run: true });
});

test("nullable indexed callables still require checked presence", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts": `
    export function invoke(callbacks: (((value: number) => number) | undefined)[]): number {
      return callbacks[0](2);
    }
  ` } }), /TS2722: Cannot invoke an object which is possibly 'undefined'/u);
});

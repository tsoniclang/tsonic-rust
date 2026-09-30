import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { staticCallableAliasFiles, staticCallableAliasObjectFiles } from "../../../../tsonic/test/fixtures/static-callable-aliases.mjs";

test("static intrinsic aliases retain exact JS API calls without runtime wrappers", { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        ...staticCallableAliasFiles,
        "index.ts": staticCallableAliasFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("static intrinsic aliases"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.doesNotMatch(source, /js_value_from_array|js_value_from_source_union|let (?:initial|alias|minimum|predicate|selected)\b[^\n]*Callable|static (?:initial|alias|minimum|predicate)\b/u);
    validateGeneratedProject("static-callable-aliases", result.artifacts, { run: true });
});

test("escaping or mutable intrinsic aliases do not obtain compile-only erasure", () => {
  for (const body of [
    "const alias = Array.isArray; export function escape(): typeof alias { return alias; }",
    "let alias = Array.isArray; export function run(value: unknown): boolean { return alias(value); }",
  ]) {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": body } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"), body);
    assert.equal(result.artifacts.length, 0, body);
  }
});

test("generic object methods do not retain compile-only intrinsic captures", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": staticCallableAliasObjectFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("intrinsic alias capture"); }',
  } });
  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(source, /capture_\d+\s*:|let (?:predicate|minimum)\b/u);
  validateGeneratedProject("static-callable-alias-object", result.artifacts, { run: true });
});

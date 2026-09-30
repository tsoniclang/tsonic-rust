import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { guardedOptionalMemberSource, rejectedCallableConditionSource, rejectedGenericCarrierSource } from "../../../../tsonic/test/fixtures/guarded-optional-members.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`guarded optional members retain native payloads (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": guardedOptionalMemberSource + '\nexport function main(): void { if (!run()) throw new Error("guarded optional members"); }' } });
    assert.deepEqual(result.diagnostics, []);
    const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(generated, /\bi64\b/u);
    assert.doesNotMatch(generated, /BigInt|exact\s+as\s+f64/u);
    validateGeneratedProject(`guarded-optional-members-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });

  test(`optional callables do not acquire implicit native truthiness (${surfaces[0] ?? "native"})`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": rejectedCallableConditionSource } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
    assert.equal(result.artifacts.length, 0);
  });

  test(`inferred generic construction preserves required native signedness (${surfaces[0] ?? "native"})`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": rejectedGenericCarrierSource } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
    assert.equal(result.artifacts.length, 0);
  });
}

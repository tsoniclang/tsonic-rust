import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeAggregateInferenceSource, nativeAggregateInferenceRejections } from "../../../../tsonic/test/fixtures/native-aggregate-inference.mjs";

test("aggregate generic inference preserves native carriers through nested arrays, records and spreads", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": nativeAggregateInferenceSource + '\nexport function main(): void { if (!run()) throw new Error("native inference"); }' } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /BigInt|i64_to_f64|u64_to_f64/u);
  validateGeneratedProject("native-aggregate-inference", result.artifacts, { run: true });
});

for (const { name, source } of nativeAggregateInferenceRejections) {
  test(`aggregate inference rejects ${name} without publishing target output`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
    assert.equal(result.artifacts.length, 0);
  });
}

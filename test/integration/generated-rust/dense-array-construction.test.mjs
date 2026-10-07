import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { denseArrayConstructionSource, denseArrayEvaluationSource } from "../../../../tsonic/test/fixtures/dense-array-construction.mjs";

for (const [name, source, surfaces] of [
  ["native", denseArrayConstructionSource, []],
  ["js", denseArrayConstructionSource, ["js"]],
  ["evaluation", denseArrayEvaluationSource, ["js"]],
]) {
  test(`dense array construction preserves exact storage and evaluation in ${name}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": source + '\nexport function main(): void { if (!run()) throw new Error("dense construction"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const generated = artifactText(result, "src/index.rs");
    assert.match(generated, /extend_from_slice/u);
    assert.doesNotMatch(generated.replace(/for value in combined\.iter_values\(\)/u, ""), /iter_values|\.to_vec\(|\.concat\(/u);
    validateGeneratedProject(`dense-array-${name}`, result.artifacts, { run: true });
  });
}

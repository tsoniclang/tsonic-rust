import assert from "node:assert/strict";
import test from "node:test";
import { inferredOptionalNumericResultFiles } from "../../../../tsonic/test/fixtures/inferred-optional-numeric-results.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`inferred optional numeric producers retain their exact ABI in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "lib", crateName: `optional_numeric_${lane}` } },
      files: inferredOptionalNumericResultFiles });
    assertNoTargetDiagnostics(result.diagnostics);
    const counts = artifactText(result, "src/counts.rs");
    const index = artifactText(result, "src/index.rs");
    assert.match(counts, /fn length\([^)]*\) -> Option<usize>/u);
    assert.match(counts, /fn wide\([^)]*\) -> Option<i64>/u);
    for (const name of ["floating", "fractional"]) {
      assert.match(counts, new RegExp(`fn ${name}\\([^)]*\\) -> Option<f64>`, "u"));
    }
    assert.match(index, /fn local\([^)]*\) -> Option<usize>/u);
    assert.match(index, /fn forwardText\([^)]*\) -> Option<String>/u);
    assert.doesNotMatch(index, /usize_to_f64|i64_to_f64|BigInt/u);
    validateGeneratedProject(`inferred-optional-numeric-${lane}`, result.artifacts.map(artifact =>
      artifact.path !== "src/index.rs" ? artifact : { ...artifact, text: `${artifact.text}
#[test]
fn exact_optional_numeric_results() {
    for _iteration in 0..10_000 {
        assert!(run([1, 2, 3]));
    }
}
` }));
  });
}

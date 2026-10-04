import assert from "node:assert/strict";
import test from "node:test";
import { closedErrorRecoveryFiles } from "../../../../tsonic/test/fixtures/closed-error-recovery.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  test(`closed project Error subtype recovery keeps exact fields, identity and live mutation in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "closed_error_recovery" } },
      files: closedErrorRecoveryFiles,
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5)
      .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /from_error/u);
    assert.equal(/failures::DetailedFailure::new\(/u.test(source), true, "derived construction keeps its own nominal class");
    assert.equal(/failures::OtherFailure::new\(/u.test(source), true, "sibling construction keeps its own nominal class");
    assert.match(artifactText(result, "src/failures.rs"), /as_error/u);
    assert.equal(validateGeneratedProject(`closed-error-recovery-${profile}`, result.artifacts, { run: true }).status, 0);
  });
}

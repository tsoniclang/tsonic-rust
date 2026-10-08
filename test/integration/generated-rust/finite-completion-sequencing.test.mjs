import assert from "node:assert/strict";
import test from "node:test";
import { finiteCompletionSequencingExecutionSource } from "../../../../tsonic/test/fixtures/finite-completion-sequencing.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("finite suspended inputs preserve order, laziness, absence, live captures and error identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": finiteCompletionSequencingExecutionSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.doesNotMatch(source, /transmute|unreachable_unchecked|\.then\(|\.then_async\(/u);
  validateGeneratedProject("finite-completion-sequencing", result.artifacts, { run: true });
});

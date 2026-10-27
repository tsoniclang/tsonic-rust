import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { liveErrorBaseWriteSource, liveErrorMixedRecoverySource, liveErrorStorageFiles } from "../../../../tsonic/test/fixtures/live-error-storage.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { errorBorrowEffectsSource, errorStackRecaptureSource } from "../../fixtures/error-effect-captures.mjs";

for (const representation of (["declaration", "arrow"]).slice(1, 2)) {
test(`captured native Error stack guard releases before exact recapture${representation === "arrow" ? " through arrow capture" : ""}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "captured_error_stack" } },
      files: { "index.ts": errorStackRecaptureSource(representation) + "\nmain();\n" } });
    assertNoTargetDiagnostics(result.diagnostics);
    assert.equal(validateGeneratedProject(`captured-error-stack-${representation}`, result.artifacts, { run: true }).status, 0);
  });
}

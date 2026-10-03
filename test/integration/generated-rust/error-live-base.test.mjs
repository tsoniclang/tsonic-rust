import assert from "node:assert/strict";
import test from "node:test";
import { liveErrorBaseWriteSource, liveErrorMixedRecoverySource, liveErrorStorageFiles } from "../../../../tsonic/test/fixtures/live-error-storage.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { errorBorrowEffectsSource, errorStackRecaptureSource } from "../../fixtures/error-effect-captures.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  test(`live inherited Error storage survives base values and throw recovery in Rust ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "live_error_storage" } },
      files: { ...liveErrorStorageFiles, "index.ts": `${liveErrorStorageFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("live Error storage failed"); }` } });
    assert.deepEqual(result.diagnostics, []);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.doesNotMatch(source, /JsError::new\([^\n]*\.message\(/);
    assert.equal(validateGeneratedProject(`live-error-storage-${profile}`, result.artifacts, { run: true }).status, 0);
  });

  test(`writes through Error base values retain native field identity in Rust ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "live_error_writes" } },
      files: { "index.ts": `${liveErrorBaseWriteSource}
export function main(): void { if (!run()) throw new Error("live Error base writes failed"); }` } });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`live-error-writes-${profile}`, result.artifacts, { run: true }).status, 0);
  });

  for (const projectError of [false, true]) {
    test(`sealed mixed throws retain writable ${projectError ? "project" : "native"} Error identity in Rust ${profile}`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: "mixed_error_recovery" } },
        files: { "index.ts": `${liveErrorMixedRecoverySource(projectError)}
export function main(): void { if (!run()) throw new Error("mixed Error recovery failed"); }` } });
      assert.deepEqual(result.diagnostics, []);
      assert.equal(validateGeneratedProject(`mixed-error-recovery-${profile}-${projectError ? "project" : "native"}`, result.artifacts, { run: true }).status, 0);
    });
  }

  for (const representation of ["declaration", "arrow"]) {
    test(`live Error borrowed reads release guards only for actual same-owner writes in Rust ${profile}${representation === "arrow" ? " arrow captures" : ""}`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: "live_error_borrows" } },
        files: { "index.ts": errorBorrowEffectsSource(representation) } });
      assert.deepEqual(result.diagnostics, []);
      assert.equal(validateGeneratedProject(`live-error-borrows-${profile}-${representation}`, result.artifacts, { run: true }).status, 0);
    });
  }
}

for (const representation of ["declaration", "arrow"]) {
  test(`captured native Error stack guard releases before exact recapture${representation === "arrow" ? " through arrow capture" : ""}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "captured_error_stack" } },
      files: { "index.ts": errorStackRecaptureSource(representation) } });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`captured-error-stack-${representation}`, result.artifacts, { run: true }).status, 0);
  });
}

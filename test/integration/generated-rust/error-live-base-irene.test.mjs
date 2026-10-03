import assert from "node:assert/strict";
import test from "node:test";
import { liveErrorBaseWriteSource, liveErrorStorageFiles } from "../../../../tsonic/test/fixtures/live-error-storage.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

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
    assert.equal(validateGeneratedProject(`irene-live-error-storage-${profile}`, result.artifacts, { run: true }).status, 0);
  });

  test(`writes through Error base values retain native field identity in Rust ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "live_error_writes" } },
      files: { "index.ts": `${liveErrorBaseWriteSource}
export function main(): void { if (!run()) throw new Error("live Error base writes failed"); }` } });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`irene-live-error-writes-${profile}`, result.artifacts, { run: true }).status, 0);
  });
}

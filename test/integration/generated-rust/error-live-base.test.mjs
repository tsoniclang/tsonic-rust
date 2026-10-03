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

  test(`live Error borrowed reads release guards only for actual same-owner writes in Rust ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "live_error_borrows" } },
      files: { "index.ts": `
        export function main(): void {
          const original = new Error("before"); const alias = original; const unrelated = new Error("other");
          function read(): string { return alias.message; }
          function other(): string { unrelated.message = "unrelated"; return "before"; }
          function write(): string { alias.message = "after"; return "before"; }
          if (original.message !== read() || original.message !== other()) throw new Error("pure reads changed");
          if (original.message !== write() || original.message !== "after") throw new Error("message guard retained");
          original.stack = "prior";
          function writeStack(): string { original.stack = "next"; return "prior"; }
          if (original.stack !== writeStack() || original.stack !== "next") throw new Error("stack guard retained");
        }` } });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`live-error-borrows-${profile}`, result.artifacts, { run: true }).status, 0);
  });
}

test("captured native Error stack guard releases before exact recapture", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "captured_error_stack" } },
    files: { "index.ts": `
      export function main(): void {
        const error = new Error("immutable native owner");
        Error.captureStackTrace(error);
        function recapture(): string | undefined { Error.captureStackTrace(error); return undefined; }
        if (error.stack === recapture() || error.stack === undefined) throw new Error("captured stack was lost");
      }` } });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(validateGeneratedProject("captured-error-stack", result.artifacts, { run: true }).status, 0);
});

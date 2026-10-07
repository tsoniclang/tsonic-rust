import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { liveErrorBaseWriteSource, liveErrorMixedRecoverySource, liveErrorStorageFiles } from "../../../../tsonic/test/fixtures/live-error-storage.mjs";
import { errorBorrowEffectsSource, errorStackRecaptureSource } from "../../fixtures/error-effect-captures.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  for (const [name, files] of [["live subclass and base identity", liveErrorStorageFiles],
    ["physical builtin and project setters", { "index.ts": liveErrorBaseWriteSource }]]) {
    test(`exact Error compilation retains ${name} in ${profile}`, () => {
      const { result } = compileRust({ surfaces, files });
      assertNoTargetDiagnostics(result.diagnostics);
      assert.ok(result.artifacts.length !== 0);
    });
  }

  test(`writable caught source Error has exact original mutable admission in ${profile}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      export function run(): boolean {
        const original = new Error("original");
        try { throw original; } catch (caught) {
          if (caught instanceof Error) caught.message = "changed";
        }
        return original.message === "changed";
      }` } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(source, /rt::MutableJsError::error\("original"\)/);
    assert.match(source, /WritableErrorObject::set_error_message/);
  });

  test(`unknown catch origins cannot fabricate native Error writable admission in ${profile}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      export function run(provider: () => void): void {
        try { provider(); } catch (caught) {
          if (caught instanceof Error) caught.message = "changed";
        }
      }` } });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_ERROR_WRITABLE_ORIGIN_MISSING"), true,
      result.diagnostics.map(diagnostic => diagnostic.code).join(", "));
    assert.deepEqual(result.artifacts, []);
  });

  for (const projectError of [false, true]) {
    test(`sealed non-Error thrown variants do not poison writable ${projectError ? "project" : "native"} Error recovery in ${profile}`, () => {
      const { result } = compileRust({ surfaces, files: { "index.ts": liveErrorMixedRecoverySource(projectError) } });
      assertNoTargetDiagnostics(result.diagnostics);
      const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
      assert.match(source, /WritableErrorObject::set_error_message/);
      assert.match(source, /ErrorTransport::Unrelated\(_\) => None/);
    });
  }

  test(`sealed Error base values retain exact admitted subclass tests in ${profile}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      class Failure extends Error { readonly code = 7; }
      export function run(value: Error): boolean { return value instanceof Failure; }
      ` } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith("/index.rs")).map(artifact => artifact.text).join("\n");
    assert.match(source, /value\.as_transport\(\)/);
    assert.match(source, /rt::ErrorTransport::Failure/);
    assert.match(source, /rt::ErrorTransport::Failure\(_\)/);
  });

  test(`Error field setters keep shared receivers immutable while actual rebinding stays mutable in ${profile}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      function mutate(error: Error): void { error.message = "changed"; }
      export function run(): boolean {
        let original = new Error("first"); original = new Error("second");
        mutate(original); return original.message === "changed";
      }` } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith("/index.rs")).map(artifact => artifact.text).join("\n");
    assert.match(source, /fn mutate\(error: rt::WritableSourceError\)/);
    assert.doesNotMatch(source, /fn mutate\(mut error/);
    assert.match(source, /let mut original/);
  });

  test(`captured Error writes publish coherent lifetime effects through arrow closures in ${profile}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": errorBorrowEffectsSource("arrow") } });
    assertNoTargetDiagnostics(result.diagnostics);
    assert.ok(result.artifacts.length !== 0);
  });
}

test("captured immutable Error stack recapture publishes coherent guard effects through an arrow closure", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": errorStackRecaptureSource("arrow") } });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.ok(result.artifacts.length !== 0);
});

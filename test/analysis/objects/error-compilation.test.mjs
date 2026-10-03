import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { liveErrorBaseWriteSource, liveErrorStorageFiles } from "../../../../tsonic/test/fixtures/live-error-storage.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  for (const [name, files] of [["live subclass and base identity", liveErrorStorageFiles],
    ["physical builtin and project setters", { "index.ts": liveErrorBaseWriteSource }]]) {
    test(`exact Error compilation retains ${name} in ${profile}`, () => {
      const { result } = compileRust({ surfaces, files });
      assert.deepEqual(result.diagnostics, []);
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
    assert.deepEqual(result.diagnostics, []);
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
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_ERROR_WRITABLE_ORIGIN_MISSING"),
      JSON.stringify(result.diagnostics));
    assert.deepEqual(result.artifacts, []);
  });

  test(`sealed Error base values retain exact admitted subclass tests in ${profile}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      class Failure extends Error { readonly code = 7; }
      export function run(value: Error): boolean { return value instanceof Failure; }
      ` } });
    assert.deepEqual(result.diagnostics, []);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith("/index.rs")).map(artifact => artifact.text).join("\n");
    assert.match(source, /value\.as_transport\(\)/);
    assert.match(source, /rt::ErrorTransport::Failure/);
  });
}

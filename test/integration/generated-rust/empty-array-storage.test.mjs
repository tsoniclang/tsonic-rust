import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { emptyArrayStorageFiles, emptyNativeArrayStorageFiles } from "../../../../tsonic/test/fixtures/empty-array-storage.mjs";

for (const surface of ["native", "js"]) test(`empty array storage retains its uninhabited element on ${surface}`, { timeout: 300_000 }, () => {
  const files = surface === "js" ? emptyArrayStorageFiles : emptyNativeArrayStorageFiles;
  const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
    target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": files["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("empty array storage"); }',
    } });
  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(source, /core::convert::Infallible/u);
  assert.doesNotMatch(source, /js_value_from_array|JsValue|\.clone\(\)/u);
  validateGeneratedProject(`empty-array-storage-${surface}`, result.artifacts, { run: true });
});

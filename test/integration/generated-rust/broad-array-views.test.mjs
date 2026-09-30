import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { broadArrayViewSource } from "../../../../tsonic/test/fixtures/broad-array-views.mjs";

test("checked broad array views retain their native backing and element identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": broadArrayViewSource + '\nexport function main(): void { if (!run()) throw new Error("broad array identity"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(source, /js_value_from_array|\.collect\(/);
  assert.match(source, /JsValue::Array/);
  validateGeneratedProject("broad-array-views", result.artifacts, { run: true });
});

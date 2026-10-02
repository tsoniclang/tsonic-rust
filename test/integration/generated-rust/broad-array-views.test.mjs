import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { broadArrayViewSource, broadArrayCategoryWriteSource } from "../../../../tsonic/test/fixtures/broad-array-views.mjs";

test("checked broad array views retain their native backing and element identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": broadArrayViewSource + '\nexport function main(): void { if (!run()) throw new Error("broad array identity"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(source, /\.collect\(|\.values\(\)\.into_iter\(\)\.map\(/);
  assert.match(source, /js_value_from_array\(/);
  assert.match(source, /with_native_element::<js_abi::JsValue, _>/);
  assert.match(source, /JsArrayElement::Value\(array_selected/);
  assert.match(source, /JsValue::Array/);
  validateGeneratedProject("broad-array-views", result.artifacts, { run: true });
});

test("category-only indexed writes preserve the checked broad native backing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": broadArrayCategoryWriteSource + '\nexport function main(): void { if (!run()) throw new Error("array category write"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(source, /set_number\(/u);
  assert.doesNotMatch(source, /\.collect\(|\.values\(\)\.into_iter\(\)\.map\(/u);
  validateGeneratedProject("broad-array-category-write", result.artifacts, { run: true });
});

for (const expression of ["value.push(8)", "value.at(1)", "value.map(item => item)"]) {
  test(`an array category cannot manufacture a typed receiver for ${expression}`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: {
      "index.ts": `export function check(value: unknown): void { if (Array.isArray(value)) { ${expression}; } }`,
    } });
    assert.equal(result.artifacts.length, 0);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SELECTED_OPERATION_UNSUPPORTED"));
  });
}

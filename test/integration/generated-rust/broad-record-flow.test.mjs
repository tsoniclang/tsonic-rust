import assert from "node:assert/strict";
import test from "node:test";
import { broadRecordFlowSource, freshBroadArraySource, mixedNativeArraySource } from "../../../../tsonic/test/fixtures/broad-record-flow.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("guarded broad record reads preserve raw storage and array backing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": broadRecordFlowSource + '\nexport function main(): void { if (!run()) throw new Error("broad record flow"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /current: .*JsValue/u);
  assert.doesNotMatch(output, /\.collect\(|\.values\(\)\.into_iter\(\)\.map\(/u);
  assert.match(output, /js_value_from_array\(/u);
  assert.match(output, /with_native_element::<js_abi::JsValue, _>/u);
  const read = output.slice(output.indexOf("let current"), output.indexOf("if current"));
  assert.match(read, /get_or_default\(/u);
  assert.doesNotMatch(read, /key\.clone\(/u);
  validateGeneratedProject("broad-record-flow", result.artifacts, { run: true });
});

test("fresh nested broad arrays retain empty, primitive and exact integer carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": freshBroadArraySource + '\nexport function main(): void { if (!run()) throw new Error("fresh broad arrays"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /9007199254740993/u);
  assert.doesNotMatch(output, /\.collect\(|\.values\(\)\.into_iter\(\)\.map\(/u);
  assert.match(output, /js_value_from_array\(/u);
  validateGeneratedProject("fresh-broad-arrays", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`heterogeneous native arrays infer exact integer union arms in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": mixedNativeArraySource + '\nexport function main(): void { if (!run()) throw new Error("mixed native array carriers"); }' } });
    assert.deepEqual(result.diagnostics, []);
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(output, /value: u64/u);
    assert.doesNotMatch(output, /BigInt|js_value_from_array|\.collect\(/u);
    validateGeneratedProject(`mixed-native-array-carriers-${lane}`, result.artifacts, { run: true });
  });
}

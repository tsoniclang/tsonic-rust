import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { typedBroadRecordFlowSource, incompatibleNativeArrayCastSource, freshTypedArrayRecordSource } from "../../../../tsonic/test/fixtures/broad-record-flow.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("typed broad record array views preserve the original backing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": typedBroadRecordFlowSource + '\nexport function main(): void { if (!run()) throw new Error("typed broad record flow"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /cast::<String>\(\)/u);
  assert.match(output, /JsArrayElement::String\(array_selected/u);
  assert.doesNotMatch(output, /flow_value\w*\.clone\(\)|\.collect\(/u);
  validateGeneratedProject("typed-broad-record-flow", result.artifacts, { run: true });
});

for (const guarded of [false, true]) test(`an erased broad-element array cannot be reinterpreted as a typed native backing (${guarded ? "guarded" : "unguarded"})`, { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": incompatibleNativeArrayCastSource(guarded) + '\nexport function main(): void { if (!run()) throw new Error("incompatible native array cast"); }' } });
  assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /(?:cast|cast_array)::<String>\(\)/u);
  assert.doesNotMatch(output, /flow_value\w*\.clone\(\)|\.collect\(/u);
  validateGeneratedProject(`incompatible-native-array-cast-${guarded ? "guarded" : "unguarded"}`, result.artifacts, { run: true });
});
test("fresh typed array producers retain inferred backing before record and return erasure", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": freshTypedArrayRecordSource + '\nexport function main(): void { if (!run()) throw new Error("fresh typed backing"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(source, /with_native_element::<String, _>/u);
  assert.doesNotMatch(source, /with_native_element::<js_abi::JsValue, _>|\.collect\(/u);
  validateGeneratedProject("fresh-typed-array-record", result.artifacts, { run: true });
});

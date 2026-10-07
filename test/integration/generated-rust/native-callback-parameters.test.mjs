import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeCallbackParametersSource } from "../../../../tsonic/test/fixtures/native-callback-parameters.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native callbacks retain explicit local arithmetic (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_parameters" } },
      files: { "index.ts": nativeCallbackParametersSource } });
    assert.deepEqual(result.diagnostics, []);
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /let mut value: f64 = /u);
    assert.doesNotMatch(output, /Box::new\([^)]*value|u8_to_f64\(.*u8_to_f64/u);
    validateGeneratedProject(`native-callback-parameters-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

test("native callbacks reject implicit precision loss from wide integers", () => {
  const { result } = compileRust({ files: { "index.ts": `
import type { nativeUint } from "@tsonic/core/types.js";
function consume(action: (value: nativeUint) => number, value: nativeUint): number { return action(value); }
export function example(value: nativeUint): number { return consume((input: number): number => input, value); }
` } });
  assert.notEqual(result.diagnostics.length, 0);
  assert.deepEqual(result.artifacts, []);
});

test("native array parameters own retained values and borrow nonescaping reads and writes", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin", crateName: "native_array_parameters" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
class Box {
  values: int32[];
  constructor(values: int32[]) { this.values = values; }
}
function retain(values: int32[]): int32[] { return values; }
function first(values: int32[]): int32 { return values[0]; }
function replace(values: int32[]): void { values[0] = 7; }
function firstForwarded(values: int32[]): int32 { return first(values); }
function replaceForwarded(values: int32[]): void { replace(values); }
export function main(): void {
  const boxed = new Box([3 as int32]);
  const values = retain([5 as int32]);
  if (firstForwarded(boxed.values) !== 3 || firstForwarded(values) !== 5) throw new Error("native ownership");
  replaceForwarded(values);
  if (firstForwarded(values) !== 7) throw new Error("native mutation");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn new\(values: Vec<i32>\)/u);
  assert.match(output, /fn retain\(values: Vec<i32>\) -> Vec<i32>/u);
  assert.match(output, /fn first\(values: &\[i32\]\)/u);
  assert.match(output, /fn replace\(values: &mut \[i32\]\)/u);
  assert.match(output, /fn firstForwarded\(values: &\[i32\]\)/u);
  assert.match(output, /fn replaceForwarded\(values: &mut \[i32\]\)/u);
  assert.doesNotMatch(output, /to_vec\(|values\.clone\(/u);
  validateGeneratedProject("native-array-parameters", result.artifacts, { run: true });
});

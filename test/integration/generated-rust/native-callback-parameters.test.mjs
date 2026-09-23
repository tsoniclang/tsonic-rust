import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native callbacks retain explicit local arithmetic (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_parameters" } },
      files: { "index.ts": `
import type { uint8 } from "@tsonic/core/types.js";
function consume(action: (value: uint8) => number): number { return action(3); }
export function main(): void {
  let captured = 0;
  const fractional = consume((value: number): number => {
    captured += value;
    value += 2;
    return value / 2;
  });
  if (fractional !== 2.5 || captured !== 3) throw new Error("authored arithmetic");
  const integral = consume((value): number => value / 2);
  if (integral !== 1) throw new Error("native arithmetic");
}
` } });
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
export function main(): void {
  const boxed = new Box([3 as int32]);
  const values = retain([5 as int32]);
  if (first(boxed.values) !== 3 || first(values) !== 5) throw new Error("native ownership");
  replace(values);
  if (first(values) !== 7) throw new Error("native mutation");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn new\(values: Vec<i32>\)/u);
  assert.match(output, /fn retain\(values: Vec<i32>\) -> Vec<i32>/u);
  assert.match(output, /fn first\(values: &mut \[i32\]\)/u);
  assert.match(output, /fn replace\(values: &mut \[i32\]\)/u);
  assert.doesNotMatch(output, /to_vec\(|values\.clone\(/u);
  validateGeneratedProject("native-array-parameters", result.artifacts, { run: true });
});

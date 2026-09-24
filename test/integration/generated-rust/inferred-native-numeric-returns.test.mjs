import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("inferred arrays and tuples retain native elements without overriding explicit contexts", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "inferred_native_elements" } },
    files: { "index.ts": `
import type { int32, int64, uint32 } from "@tsonic/core/types.js";
export function main(): void {
  const wide: int64 = 9007199254740993n;
  const maximum: uint32 = 4294967295;
  const small: int32 = 17;
  const values = [wide];
  const tuple = [wide, maximum, "text"] as const;
  const explicit: [number, number] = [small, maximum];
  if (values.length !== 1 || values[0] !== wide ||
    tuple[0] !== wide || tuple[1] !== maximum || tuple[2] !== "text" ||
    explicit[0] !== 17 || explicit[1] !== 4294967295) throw new Error("native elements");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /(?:JsArray|Array)<i64>/u);
  assert.match(output, /\(i64, u32, String\)/u);
  assert.match(output, /\(f64, f64\)/u);
  assert.doesNotMatch(output, /BigInt|i64_to_f64/u);
  validateGeneratedProject("inferred-native-elements", result.artifacts, { run: true });
});

test("inferred numeric returns preserve native operations through aliases and forward calls", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "inferred_native_results" } },
    files: {
      "counts.ts": `
import type { FixedArray, int32, uint8 } from "@tsonic/core/types.js";
export function forwarded(values: FixedArray<uint8, 2n>) { return count(values); }
export function count(values: FixedArray<uint8, 2n>) { const length = values.length; return length; }
export function returnedLength(values: FixedArray<uint8, 2>) { return identity(values).length; }
export function identity(values: FixedArray<uint8, 2>) { return values; }
export function textLength(text: string) { let length = text.length; return length; }
export function annotated(value: int32): number { return value; }
export function ordinary(value: number) { return value / 2; }
export function optional(text: string, selected: boolean) { if (selected) return text.length; return undefined; }
`,
      "index.ts": `
import { textLength, annotated, ordinary, optional, returnedLength } from "./counts.js";
import type { uint8 } from "@tsonic/core/types.js";
export function main(): void {
  const values: [uint8, uint8] = [1, 2];
  if (textLength("abc") !== 3 || annotated(3) !== 3 || ordinary(5) !== 2.5 ||
    returnedLength(values) !== 2 || optional("abc", true) !== 3 || optional("abc", false) !== undefined) throw new Error("native results");
}
`,
    } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/counts.rs");
  assert.match(output, /fn forwarded\(values: \[u8; 2\]\) -> usize/u);
  assert.match(output, /fn count\(values: \[u8; 2\]\) -> usize/u);
  assert.match(output, /fn returned_length\(values: \[u8; 2\]\) -> usize/u);
  assert.match(output, /fn text_length\([^)]*\) -> usize/u);
  assert.match(output, /fn annotated\([^)]*\) -> f64/u);
  assert.match(output, /fn ordinary\(value: f64\) -> f64/u);
  assert.match(output, /fn optional\([^)]*\) -> Option<usize>/u);
  validateGeneratedProject("inferred-native-numeric-returns", result.artifacts, { run: true });
});

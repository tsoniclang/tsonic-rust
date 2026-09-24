import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
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
  assert.match(output, /\[f64; 2\]/u);
  assert.doesNotMatch(output, /tuple\.clone\(\)|tuple\.\d\.clone\(\)/u);
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

test("tuple projections borrow retained owners and copy only an owned selected field", { timeout: 300_000 }, () => {
  const { result } = compileRust({ packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_tuple_projection" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { FixedArray, int32, int64 } from "@tsonic/core/types.js";
let sequence: int32 = 0;
function create(): [int64, string] {
  sequence = sequence * 10 + 1;
  return [9007199254740993n, "owned"];
}
function select(): 1 { sequence = sequence * 10 + 2; return 1; }
export function main(): void {
  const wide: int64 = 9007199254740993n;
  const pair: [int64, string] = [wide, "retained"];
  const kept = pair[1];
  const last = 1 as const;
  check(pair[0] === wide && pair[1] === "retained" && pair[last] === "retained");
  check(kept === "retained");
  const nested: [int32, [int64, string]] = [7, [wide, "nested"]];
  check(nested[0] === 7 && nested[1][0] === wide && nested[1][1] === "nested");
  const single: [int32, string] = [1, "moved"];
  const moved = single[1];
  check(moved === "moved");
  const retainedArray: FixedArray<string, 2> = ["first", "second"];
  const first = retainedArray[0];
  check(first === "first" && retainedArray[0] === "first" && retainedArray[1] === "second");
  const ownedArray: FixedArray<string, 2> = ["discarded", "selected"];
  const selectedElement = ownedArray[1];
  check(selectedElement === "selected");
  const ownedFirst: FixedArray<string, 2> = ["selected first", "discarded"];
  check(ownedFirst[0] === "selected first");
  const selected = create()[select()];
  check(selected === "owned" && sequence === 12);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /let kept: String = pair\.1\.clone\(\);/u);
  assert.match(output, /let moved: String = single\.1;/u);
  assert.match(output, /let first: String = retained_array\[0\]\.clone\(\);/u);
  assert.match(output, /owned_array\.into_iter\(\)\.nth\(1\)\.unwrap\(\)/u);
  assert.match(output, /owned_first\.into_iter\(\)\.next\(\)\.unwrap\(\)/u);
  assert.doesNotMatch(output, /(?:pair|nested|single|retained_array|owned_array|owned_first)\.clone\(\)|nested\.1\.clone\(\)|create\([^)]*\)\.clone\(\)/u);
  validateGeneratedProject("native-tuple-projection", result.artifacts, { run: true });
});

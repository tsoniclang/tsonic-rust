import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

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

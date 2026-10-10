import assert from "node:assert/strict";
import test from "node:test";
import { nativeParsingRadixSource } from "../../../../tsonic/test/fixtures/native-parsing-radix.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("both parsing APIs preserve native numeric radix carriers and optional absence", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": nativeParsingRadixSource + `
export function main(): void { if (!run()) throw new Error("native parsing radix contract"); }
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("native-parsing-radix", result.artifacts, { run: true });
});

test("parsing radix normalization does not replace native checked narrowing with modular radix conversion", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
function integer(value: int32): int32 { return value; }
export function checked(value: number): int32 { return integer(value); }
export function main(): void {
  if (checked(17) !== 17) throw new Error("exact native integer conversion");
  let rejected = false;
  try { checked(4294967298); } catch { rejected = true; }
  if (!rejected || parseInt("10", 4294967298) !== 2) throw new Error("native narrowing is not parsing radix conversion");
}
` }, target: { id: "rust", options: { outputType: "bin" } } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /rt::conversions::f64_to_i32\(value\)\?/u);
  validateGeneratedProject("native-parsing-radix-narrowing", result.artifacts, { run: true });
});

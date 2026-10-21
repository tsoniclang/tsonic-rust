import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("native zero comparisons preserve runtime effects and compile without warning suppressions", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
let calls: int32 = 0;
function callCount(): int32 { return calls; }
function next(): nativeUint { calls++; return 3; }
function observe(values: int32[]): int32[] { calls++; return values; }
function signed(value: int32): boolean { return value < 0; }
function floating(value: number): boolean { return value < 0; }
export function main(): void {
  const values: int32[] = [];
  if (values.length !== 0 || !(0 >= values.length)) throw new Error("empty");
  values.push(3);
  if (!(values.length > 0) || values.length <= 0 || !(0 < values.length)) throw new Error("nonempty");
  if (next() < 0 || !(next() >= 0) || callCount() !== 2) throw new Error("effects");
  if (next() <= 0 || !(0 < next()) || callCount() !== 4) throw new Error("native zero equality");
  if (!(observe(values).length >= 1) || !(1 <= observe(values).length) || callCount() !== 6) throw new Error("nonempty once");
  const empty: int32[] = [];
  if (!(observe(empty).length < 1) || !(1 > observe(empty).length) || callCount() !== 8) throw new Error("empty once");
  if (next() < 1 || !(next() >= 1) || callCount() !== 10) throw new Error("native one equality");
  if (!signed(-1) || !floating(-0.5)) throw new Error("signed controls");
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /values\.is_empty\(\)/u);
  assert.doesNotMatch(output, /\.len\(\) (?:>=|<) 1\b/u);
  assert.doesNotMatch(output, /allow\([^)]*(?:len_zero|unused_comparisons|absurd_extreme)/u);
  validateGeneratedProject("native-zero-comparisons", result.artifacts, { run: true });
});

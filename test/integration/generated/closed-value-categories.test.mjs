import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeCalls, nativeFunction, nativeMethods, nativeNodes } from "../../helpers/native-ast.mjs";

test("closed values retain native categories and checked primitive projections across files", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: {
      "values.ts": `
export function category(value: unknown): string { return typeof value; }
export function describe(value: unknown): string {
  if (typeof value === "string") return value.substring(0, 3);
  if (typeof value === "boolean") return value ? "true" : "false";
  return typeof value;
}
export function take(value: unknown): string {
  if (typeof value === "string") return value;
  return "other";
}
`, "index.ts": `
import { check } from "@acme/testing";
import type { int32, int64, uint64, float32 } from "@tsonic/core/types.js";
import { category, describe, take } from "./values.js";
export function main(): void {
  const small: int32 = 42;
  const signed: int64 = -9007199254740993n;
  const unsigned: uint64 = 18446744073709551615n;
  const single: float32 = 0.1;
  check(category(small) === "number" && category(single) === "number");
  check(category(signed) === "bigint" && category(unsigned) === "bigint");
  check(describe("native text") === "nat" && describe(true) === "true");
  check(describe(false) === "false" && describe(undefined) === "object");
  check(take("moved") === "moved" && take(17) === "other");
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const emitted = result.artifacts.find(artifact => artifact.path === "src/values.rs")?.text;
  assert.ok(emitted);
  assert.doesNotMatch(emitted, /\.clone\(\)/u);
  assert.match(emitted, /if value\.type_of\(\) == "string"/u);
  assert.match(emitted, /match &value/u);
  assert.match(emitted, /return match value/u);
  validateGeneratedProject("closed-value-categories", result.artifacts, { run: true });
});

test("native category observations retain operand effects once without materializing their borrowed result", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";
let observations: int32 = 0;
function next(value: unknown): unknown { observations += 1; return value; }
function tick(): int32 { observations += 10; return 7; }
export function observe(value: unknown): boolean { return typeof next(value) === "string"; }
export function fixed(): boolean { return typeof tick() === "number"; }
export function owned(value: unknown): string { return typeof value; }
export function main(): void {
  check(observe("sample") && observations === 1);
  check(fixed() && observations === 11);
  check(owned(true) === "boolean" && observations === 11);
}
main();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const observation = nativeFunction(result, "observe");
  assert.equal(nativeCalls(observation, "next").length, 1, "the original dynamic operand executes exactly once");
  assert.equal(nativeMethods(observation, "type_of").length, 1, "one selected native category query observes that result");
  assert.equal(nativeNodes(observation, node => node.kind === "owned-string-from-borrowed-str" || node.kind === "string-literal").length,
    0, "a native category comparison never allocates an owned String");
  const fixed = nativeFunction(result, "fixed");
  assert.equal(nativeCalls(fixed, "tick").length, 1, "a statically known category still evaluates its original effect once");
  assert.equal(nativeNodes(fixed, node => node.kind === "owned-string-from-borrowed-str" || node.kind === "string-literal").length,
    0, "the static category comparison also keeps its native borrowed result");
  assert.equal(nativeNodes(nativeFunction(result, "owned"), node => node.kind === "owned-string-from-borrowed-str").length,
    1, "a genuinely owning source result retains its required native String materialization");
  validateGeneratedProject("native-category-observation-effects", result.artifacts, { run: true });
});

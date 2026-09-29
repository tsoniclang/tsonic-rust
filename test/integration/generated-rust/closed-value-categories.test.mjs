import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

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
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = result.artifacts.find(artifact => artifact.path === "src/values.rs")?.text;
  assert.ok(emitted);
  assert.doesNotMatch(emitted, /\.clone\(\)/u);
  assert.match(emitted, /if value\.type_of\(\) == "string"/u);
  assert.match(emitted, /match &value/u);
  assert.match(emitted, /return match value/u);
  validateGeneratedProject("closed-value-categories", result.artifacts, { run: true });
});

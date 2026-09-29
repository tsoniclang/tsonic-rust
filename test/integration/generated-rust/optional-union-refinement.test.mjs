import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`optional union refinement retains absence on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
function selectHost(value: string | (() => string) | undefined): string | undefined {
  if (typeof value === "function") return value();
  return value;
}
function kind(value: string | undefined): string { return typeof value; }
class Counter { value = 0; }
function counted(value: string | undefined, calls: Counter): string | undefined { calls.value++; return value; }
function countedNumber(calls: Counter): number { calls.value++; return 3; }
export function run(): boolean {
  const calls = new Counter();
  const present = typeof counted("host", calls);
  const missing = typeof counted(undefined, calls);
  const direct = typeof countedNumber(calls);
  const compared = typeof countedNumber(calls) === "number";
  const inverse = typeof countedNumber(calls) !== "number";
  return selectHost("host") === "host" && selectHost(() => "callback") === "callback" &&
    selectHost(undefined) === undefined && kind("host") === "string" && kind(undefined) === "object" &&
    present === "string" && missing === "object" && direct === "number" && compared && !inverse && calls.value === 5;
}
export function main(): void { check(run()); }
` } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("optional-union-refinement", result.artifacts, { run: true });
  });
}

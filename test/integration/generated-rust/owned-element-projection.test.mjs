import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("owned array results move their payload without a second string copy", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "reads.ts": `
export function first(values: string[]): string { return values[0]; }
export function firstLength(values: string[]): number { return values[0].length; }
export function repeated(values: string[]): string {
  const first = values[0];
  values[0] = "changed";
  return first + ":" + first + ":" + values[0];
}
`,
      "index.ts": `
import { check } from "@acme/testing";
import { first, firstLength, repeated } from "./reads.js";
export function main(): void {
  const values = ["café😀"];
  check(first(values) === "café😀");
  check(firstLength(values) === 9);
  check(repeated(values) === "café😀:café😀:changed");
  check(values[0] === "changed");
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/reads.rs");
  assert.match(output, /get_number\(/u);
  assert.doesNotMatch(output, /flow_value(?:_\d+)?\.clone\(\)/u);
  assert.doesNotMatch(output, /get_number\([^;]+?\)\s*\.as_ref\(\)/u);
  validateGeneratedProject("owned-array-result-projection", result.artifacts, { run: true });
});

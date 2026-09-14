import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("numeric generic constraints preserve exact mixed comparisons and caller bounds", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_numeric_constraints" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { uint64 } from "@tsonic/core/types.js";
function above<T extends number | bigint>(value: T): boolean { return value > 9007199254740992; }
function forward<T extends number | bigint>(value: T): boolean { return above(value); }
function equal<T extends number | bigint>(value: T): boolean { return value === 2 && value !== 3; }
function bounded<T extends number | bigint>(value: T): boolean { return value >= 2n && value <= 2n && !(value < 2n); }
export function main(): void {
  check(forward(9007199254740993n) && !forward(9007199254740992));
  check(equal(2) && !equal(2n) && bounded(2) && bounded(2n));
  const large: uint64 = 18446744073709551615n;
  check(forward(large));
  check(!above(Number.NaN) && above(Number.POSITIVE_INFINITY) && !above(Number.NEGATIVE_INFINITY));
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("generic-numeric-constraints", result.artifacts, { run: true });
});

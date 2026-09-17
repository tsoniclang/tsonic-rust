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

test("numeric constructor constraints and mixed literal comparisons retain source domains", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_numeric_constructors" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { uint64 } from "@tsonic/core/types.js";
function toNumber<N extends number | bigint>(value: N): number { return Number(value); }
function toBigInt<N extends number | bigint>(value: N): bigint { return BigInt(value); }
function forward<N extends number | bigint>(value: N): bigint { return toBigInt(value); }
class Extent<N extends number | bigint> {
  readonly length: N;
  constructor(length: N) { this.length = length; }
  size(): number { return Number(this.length); }
  exact(): bigint { return BigInt(this.length); }
}
function valid(low: number | bigint, high: number | bigint, extent: number | bigint): boolean {
  const start = BigInt(low);
  const end = BigInt(high);
  if (start < 0 || (end < start || end > extent)) return false;
  return true;
}
function mixed(value: bigint): boolean { return value < -0.5 && -0.5 > value && value <= 0; }
function reverse(value: number): boolean { return -1n < value && value < 1n; }
export function main(): void {
  check(toNumber(7) === 7 && toNumber(7n) === 7);
  check(toNumber(9007199254740993n) === 9007199254740992);
  const wide: uint64 = 18446744073709551615n;
  const previous: uint64 = wide - 1n;
  check(previous === 18446744073709551614n);
  check(forward(9007199254740993n) === 9007199254740993n && forward(7) === 7n);
  const extent = new Extent(9007199254740993n);
  check(extent.size() === 9007199254740992 && extent.exact() === 9007199254740993n);
  check(mixed(-1n) && !mixed(0n) && reverse(0.5) && !reverse(Number.NaN));
  check(valid(0, 2n, 3) && !valid(-1n, 2n, 3) && !valid(1, 5, 3n));
  let rejected = false;
  try { toBigInt(3.5); } catch { rejected = true; }
  check(rejected);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("generic-numeric-constructors", result.artifacts, { run: true });
});

test("unconstrained numeric constructor arguments do not acquire a native numeric trait", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: { "index.ts": `export function convert<T>(value: T): number { return Number(value); }` },
  });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SELECTED_OPERATION_UNSUPPORTED"));
  assert.deepEqual(result.artifacts, []);
});

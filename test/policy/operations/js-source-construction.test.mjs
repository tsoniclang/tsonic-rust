import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { selectJsSurfaceOperation, selectJsSurfaceConstructor } from "../../../dist/policy/operations/js-surface.js";
import { rustSourcePrimitiveTargetType, rustBigIntTargetType, rustEmptyObjectTargetType } from "../../../dist/target-model/types/index.js";

test("builtin construction selection retains exact numeric and identity carriers", () => {
  for (const name of ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint"]) {
    const carrier = rustSourcePrimitiveTargetType(name);
    const selected = selectJsSurfaceOperation({ ownerName: "BigIntConstructor", memberName: "call", operationKind: "call", argumentCarriers: [carrier] });
    assert.equal(selected?.fact.operationId, "tsonic.rust.js.BigIntConstructor.call.call.integer", name);
    assert.deepEqual(selected.resultCarrier, rustBigIntTargetType());
    assert.deepEqual(selected.parameterCarriers, [carrier]);
  }
  const length = selectJsSurfaceConstructor({ className: "Array", typeArgumentCarriers: [rustEmptyObjectTargetType()], argumentCarriers: [rustSourcePrimitiveTargetType("int32")] });
  assert.equal(length?.fact.operationId, "tsonic.rust.js.Array.constructor.length");
  assert.equal(length.fact.isFallible, true);
  assert.equal(selectJsSurfaceOperation({ ownerName: "OtherConstructor", memberName: "call", operationKind: "call", argumentCarriers: [rustBigIntTargetType()] }), undefined);
});

test("BigInt builtin construction executes without rounding wide integers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "bigint_construction" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { int64, uint64, int128 } from "@tsonic/core/types.js";

function convert(value: number): bigint { return BigInt(value); }
function unchanged(value: bigint): bigint { return globalThis.BigInt(value); }

export function main(): void {
  const signed: int64 = -9007199254740993n;
  const unsigned: uint64 = 9007199254740993n;
  const wide: int128 = 170141183460469231731687303715884105727n;
  check(BigInt(signed) === -9007199254740993n);
  check(BigInt(unsigned) === 9007199254740993n);
  check(BigInt(wide) === 170141183460469231731687303715884105727n);
  check(convert(-42) === -42n);
  check(unchanged(9007199254740993n) === 9007199254740993n);
  check(BigInt(true) === 1n && BigInt(false) === 0n);
  check(BigInt("0xff") === 255n && BigInt("9007199254740993") === 9007199254740993n);
  let rejected = false;
  try { convert(1.5); } catch { rejected = true; }
  check(rejected);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /bigint_from_integer/u);
  const run = validateGeneratedProject("bigint-construction", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});

test("array construction and frozen tokens retain sparse and identity semantics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "array_token_construction" } },
    files: { "index.ts": `
import { check } from "@acme/testing";

function filled<T>(length: number, value: T): T[] {
  return new Array<T>(length).fill(value);
}
function retain(token: object): object { return token; }
export function main(): void {
  const first: object = {};
  const alias = retain(first);
  check(!Object.isFrozen(alias));
  const frozen = Object.freeze(first);
  check(frozen === alias && Object.isFrozen(alias));
  const second: object = Object.freeze({});
  check(second !== first);
  const tokens = new Set<object>();
  tokens.add(first);
  check(tokens.has(alias) && !tokens.has(second));
  const slots = new Array<object>(3);
  check(slots.length === 3);
  let visits = 0;
  slots.forEach(() => { visits += 1; });
  check(visits === 0);
  slots.fill(first);
  check(slots[0] === alias && slots[2] === alias);
  const generic = filled(2, second);
  check(generic[0] === second && generic[1] === second);
  const empty = new Array<number>(0);
  const items = new Array<number>(3, 4);
  const single = Array.of<number>(3);
  const called = Array<number>(2);
  check(empty.length === 0 && items.length === 2 && single.length === 1 && called.length === 2);
  let rejected = false;
  try { new Array<object>(-1); } catch { rejected = true; }
  check(rejected);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("array-token-construction", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});

test("same-spelled local declarations do not become builtins", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "construction_shadows" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
function BigInt(value: number): number { return value + 1; }
const Object = { freeze(value: number): number { return value + 2; } };
export function main(): void { check(BigInt(4) === 5 && Object.freeze(4) === 6); }
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /bigint_from_|EmptyObject::freeze/u);
  const run = validateGeneratedProject("construction-shadows", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});

test("freezing a writable nonempty carrier is not erased", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function example(): number {
  const value = { count: 1 };
  Object.freeze(value);
  value.count = 2;
  return value.count;
}
` } });
  assert(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SELECTED_OPERATION_UNSUPPORTED"));
  assert.equal(result.artifacts.length, 0);
});

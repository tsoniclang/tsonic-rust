import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustIntegerTruncationConversionMatches } from "../../../dist/target-model/conversions/integer-truncation.js";
import { rustBigIntTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { nativeNumericTextFunctions } from "../../../../tsonic/test/fixtures/native-numeric-text.mjs";

test("bounded integer results use native words without a BigInt result allocation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_integer_results" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
${nativeNumericTextFunctions}
import type { int128, uint128 } from "@tsonic/core/types.js";
function signed(value: int64): int64 { return BigInt.asIntN(64, value); }
function unsigned(value: int64): uint64 { return BigInt.asUintN(64, value); }
function wide(value: bigint): int128 { return BigInt.asIntN(128, value); }
function wideUnsigned(value: bigint): uint128 { return BigInt.asUintN(128, value); }
let visits = 0;
function operand(): int64 { visits += 1; return 9007199254740993n; }
export function main(): void {
  const exact: int64 = 9007199254740993n;
  check(signed(exact) === exact);
  check(signed(operand()) === exact && visits === 1);
  check(unsigned(-1n) === 18446744073709551615n);
  check(wide(170141183460469231731687303715884105727n) === 170141183460469231731687303715884105727n);
  check(wideUnsigned(-1n) === 340282366920938463463374607431768211455n);
  const word: nativeUint = 100000;
  check(word === 100000);
  check(Number.isSafeInteger(exact) && Number.isInteger(exact));
  check(Number.isFinite(exact) && !Number.isNaN(exact));
  check(exactWord().toString() === "9007199254740993" && nativePredicates(exact));
  check(signedText(exact) === "9007199254740993");
  check(unsignedHex(18446744073709551615n) === "ffffffffffffffff");
  check(preciseSingle(0.1) === "0.1" && fixedSingle(12.5) === "12.50");
  check(wideIntegerText(1606938044258990275541962092341162602522202993782792835301376n) === "1606938044258990275541962092341162602522202993782792835301376");
  check(wideIntegerHex(1606938044258990275541962092341162602522202993782792835301376n) === "${(1n << 200n).toString(16)}");
  const input = new Int16Array([1, 2, 127]);
  const copy = copyTyped(input);
  const assigned = new Uint8Array(3);
  assignTyped(assigned, input);
  input[0] = 7;
  check(copy[0] === 1 && assigned[2] === 127);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /bigint_as_int_native/u);
  assert.match(output, /bigint_as_uint_native/u);
  assert.doesNotMatch(output, /bigint_as_(?:int|uint)_n\b/u);
  validateGeneratedProject("native-integer-results", result.artifacts, { run: true });
});

test("native result conversion proves the complete signedness and width domain", () => {
  for (const width of [8, 16, 32, 64, 128]) {
    for (const signed of [false, true]) {
      const target = rustSourcePrimitiveTargetType(`${signed ? "int" : "uint"}${width}`);
      const proof = { kind: "integer-truncation", signed, width };
      assert(rustIntegerTruncationConversionMatches(rustBigIntTargetType(), target, proof));
      assert(!rustIntegerTruncationConversionMatches(rustBigIntTargetType(), target, { ...proof, width: width + 1 }));
      assert(!rustIntegerTruncationConversionMatches(rustSourcePrimitiveTargetType("float64"), target, proof));
      assert(!rustIntegerTruncationConversionMatches(rustBigIntTargetType(), target, { ...proof, width: 1.5 }));
    }
  }
});

for (const expression of ["BigInt.asIntN(bits, value)", "BigInt.asIntN(65, value)", "BigInt.asUintN(64, value)"]) {
  test(`native signed conversion rejects an unproved result: ${expression}`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int64 } from "@tsonic/core/types.js";
export function narrow(bits: number, value: bigint): int64 { return ${expression}; }
` } });
    assert(result.diagnostics.length > 0);
    assert.equal(result.artifacts.length, 0);
  });
}

test("a same-spelled local call cannot obtain the built-in integer proof", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int64 } from "@tsonic/core/types.js";
export function narrow(value: bigint): int64 {
  const BigInt = { asIntN(bits: number, operand: bigint): bigint { return operand; } };
  return BigInt.asIntN(64, value);
}
` } });
  assert(result.diagnostics.length > 0);
  assert.equal(result.artifacts.length, 0);
});

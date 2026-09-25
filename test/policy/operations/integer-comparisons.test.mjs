import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNumericComparisonPromotion } from "../../../dist/policy/operations/numeric/promotion.js";
import { selectRustBinaryOperator } from "../../../dist/policy/operations/operators/rules.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { rustNumericPromotionKind } from "../../../dist/target-model/conversions/numeric-promotion.js";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const integerKinds = ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint"];
const carrier = name => ({ kind: "source-primitive", name });

test("integer comparison has one exact symmetric domain without changing arithmetic promotion", () => {
  for (const left of integerKinds) for (const right of integerKinds) {
    const arithmetic = rustNumericPromotionKind(left, right);
    const expected = arithmetic ?? (left !== "uint128" && right !== "uint128" ? "int128" : undefined);
    const selected = selectRustNumericComparisonPromotion(carrier(left), carrier(right));
    assert.equal(selected?.carrier.name, expected, `${left} / ${right}`);
    for (const operator of ["<", "<=", ">", ">=", "===", "!=="]) {
      const operation = selectRustBinaryOperator(operator, carrier(left), carrier(right));
      assert.equal(operation !== undefined, expected !== undefined, `${left} ${operator} ${right}`);
      if (operation === undefined) continue;
      assert.equal(operation.kind, "operator-token");
      assert.equal(operation.resultCarrier.name, "bool");
      for (const conversion of [operation.leftConversion, operation.rightConversion]) {
        if (conversion === undefined) continue;
        const contract = rustValueConversionContract(conversion);
        assert.equal(contract?.lowering, "numeric-cast");
        assert.equal(contract.fallible, false);
        assert.equal(contract.target.name, expected);
      }
    }
    assert.equal(selectRustBinaryOperator("+", carrier(left), carrier(right))?.resultCarrier.name, arithmetic);
  }
  for (const name of ["bool", "char", "decimal"]) {
    assert.equal(selectRustNumericComparisonPromotion(carrier(name), carrier("native-uint")), undefined);
  }
  assert.equal(selectRustNumericComparisonPromotion(carrier("int32"), carrier("float64"))?.carrier.name, "float64");
});

test("mixed integer comparisons preserve signs, wide values and single evaluation natively", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "exact_integer_comparisons" } },
    files: { "index.ts": `
import type { int32, int64, uint64, nativeUint } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
let calls: int32 = 0;
function next(): int32 { calls++; return -1; }
export function inBounds(index: int32, length: nativeUint): boolean { return index >= 0 && index < length; }
function ordered(left: int64, right: uint64): boolean {
  return left < right && left <= right && !(left > right) && !(left >= right) &&
    left !== right && !(left === right) && right > left && right >= left &&
    !(right < left) && !(right <= left) && right !== left && !(right === left);
}
export function main(): void {
  const maximum: uint64 = 18446744073709551615n;
  const minimum: int64 = -9223372036854775808n;
  const larger: uint64 = 9007199254740993n;
  const smaller: int64 = 9007199254740992n;
  const zero: uint64 = 0n;
  const signedZero: int64 = 0n;
  check(ordered(minimum, maximum) && ordered(-1n, zero) && ordered(smaller, larger));
  check(!(signedZero !== zero));
  check(signedZero === zero);
  check(!(signedZero > zero));
  check(!(signedZero < zero));
  check(signedZero >= zero);
  check(signedZero <= zero);
  check(zero >= signedZero);
  check(zero <= signedZero);
  check(!inBounds(-1, 4) && !inBounds(4, 4) && !inBounds(0, 0) && inBounds(0, 4) && inBounds(3, 4));
  check(next() < maximum && calls === 1);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /as i128/u);
  assert.doesNotMatch(output, /f64|SourceNumeric|JsNumeric|BigInt|try_from/u);
  validateGeneratedProject("exact-integer-comparisons", result.artifacts, { run: true });
});

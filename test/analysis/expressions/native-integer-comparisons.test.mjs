import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustNativeComparisons } from "../../../dist/analysis/expressions/native-comparisons.js";
import { createRustNativeComparisonProducer } from "../../../dist/analysis/program/records/native-comparisons.js";

function select(operator, first, second, name = "int32") {
  const expression = {}, left = {}, right = {};
  const producer = createRustNativeComparisonProducer(() => {});
  const literals = new Map([[left, first], [right, second]]);
  const ast = { is: { IsBinaryExpression: node => node === expression, IsParenthesizedExpression: () => false },
    as: { AsBinaryExpression: node => node === expression ? { Left: left, Right: right } : undefined } };
  analyzeRustNativeComparisons({ source: { ast }, records: {
    targetOperation: { get: node => node === expression ? { kind: "operator-token", operator } : undefined },
    literalValue: { get: node => {
      const integer = literals.get(node);
      return integer === undefined ? undefined : { form: "numeric", integer };
    } },
    valueRead: { get: () => ({ value: { kind: "source-primitive", name } }) },
  } }, [expression], producer);
  return producer.records.nativeComparison.get(expression);
}

test("integer equality folds exact native literals without floating-point rounding", () => {
  for (const [left, right, equal, carrier] of [
    [0n, 0n, true, "int32"],
    [9007199254740993n, 9007199254740992n, false, "uint64"],
    [340282366920938463463374607431768211455n, 340282366920938463463374607431768211455n, true, "uint128"],
    [-42n, -42n, true, "int64"],
  ]) {
    assert.deepEqual(select("==", left, right, carrier), { kind: "integer-constant", value: equal });
    assert.deepEqual(select("!=", left, right, carrier), { kind: "integer-constant", value: !equal });
  }
});

test("integer equality does not erase operands or infer floating-point comparisons", () => {
  for (const carrier of ["int32", "float32", "float64"]) {
    assert.equal(select("==", undefined, 0n, carrier).kind, "ordinary");
    assert.equal(select("==", 0n, undefined, carrier).kind, "ordinary");
  }
  assert.equal(select("+", 0n, 0n).kind, "ordinary");
  assert.deepEqual(select("==", 0x0n, 0n), { kind: "integer-constant", value: true },
    "checked hexadecimal evidence is exact; generated token parsing is not the proof");
});

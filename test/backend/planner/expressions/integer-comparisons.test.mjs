import assert from "node:assert/strict";
import test from "node:test";
import { foldRustIntegerComparison } from "../../../../dist/backend/target-ast/integer-comparisons.js";

const integer = text => ({ kind: "int-literal", text });

test("integer equality folds exact native literals without floating-point rounding", () => {
  for (const [left, right, equal] of [
    ["0usize", "0", true],
    ["9007199254740993u64", "9007199254740992", false],
    ["340282366920938463463374607431768211455u128", "340282366920938463463374607431768211455", true],
    ["-42i64", "-42", true],
  ]) {
    assert.deepEqual(foldRustIntegerComparison("==", integer(left), integer(right)), { kind: "bool-literal", value: equal });
    assert.deepEqual(foldRustIntegerComparison("!=", integer(left), integer(right)), { kind: "bool-literal", value: !equal });
  }
});

test("integer equality does not erase operands or infer floating-point comparisons", () => {
  for (const operand of [
    { kind: "call", path: "next", args: [] },
    { kind: "float-literal", text: "0.0" },
    integer("0.0f64"),
    integer("0x0"),
  ]) {
    assert.equal(foldRustIntegerComparison("==", operand, integer("0")), undefined);
    assert.equal(foldRustIntegerComparison("==", integer("0"), operand), undefined);
  }
  assert.equal(foldRustIntegerComparison("+", integer("0"), integer("0")), undefined);
});

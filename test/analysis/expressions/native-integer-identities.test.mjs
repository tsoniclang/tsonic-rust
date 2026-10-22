import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustNativeComparisons } from "../../../dist/analysis/expressions/native-comparisons.js";
import { createRustNativeComparisonProducer } from "../../../dist/analysis/program/records/native-comparisons.js";

// The all-bits identity decision (`value & -1` on a signed integer keeps `value`) moved from the planner, which read
// generated literal syntax, to native comparison analysis over checked source literals. These cases carry over the
// planner test's assertions.
function select(operator, first, second, resultCarrier, conversions = {}) {
  const expression = {}, left = {}, right = {};
  const producer = createRustNativeComparisonProducer(() => {});
  const literals = new Map([[left, first], [right, second]]);
  const ast = { is: { IsBinaryExpression: node => node === expression, IsParenthesizedExpression: () => false,
    IsIdentifier: () => false, IsStringLiteral: () => false, IsNoSubstitutionTemplateLiteral: () => false },
    as: { AsBinaryExpression: node => node === expression ? { Left: left, Right: right } : undefined } };
  analyzeRustNativeComparisons({ source: { ast }, records: {
    targetOperation: { get: node => node === expression ? { kind: "operator-token", operator, resultCarrier, ...conversions } : undefined },
    literalValue: { get: node => {
      const integer = literals.get(node);
      return integer === undefined ? undefined : { form: "numeric", integer };
    } },
    valueRead: { get: () => ({ value: resultCarrier }) },
  } }, [expression], producer);
  return producer.records.nativeComparison.get(expression);
}

test("signed native all-bits identities retain the exact operand", () => {
  for (const name of ["int8", "int16", "int32", "int64", "native-int"]) {
    const carrier = { kind: "source-primitive", name };
    assert.deepEqual(select("&", undefined, -1n, carrier), { kind: "integer-identity", operand: "left" }, name);
    assert.deepEqual(select("&", -1n, undefined, carrier), { kind: "integer-identity", operand: "right" }, name);
  }
});

test("all-bits identity requires a signed integer, the & operator, an exact -1 literal and no operand conversion", () => {
  for (const carrier of [{ kind: "source-primitive", name: "uint32" },
    { kind: "source-primitive", name: "float64" }, { kind: "type-parameter", identity: "Custom", name: "Custom" }]) {
    assert.equal(select("&", undefined, -1n, carrier).kind, "ordinary", JSON.stringify(carrier));
  }
  const signed = { kind: "source-primitive", name: "int32" };
  assert.equal(select("|", undefined, -1n, signed).kind, "ordinary");
  assert.equal(select("&", undefined, -2n, signed).kind, "ordinary");
  assert.equal(select("&", undefined, undefined, signed).kind, "ordinary", "a non-literal mask is not an identity");
  assert.equal(select("&", undefined, -1n, signed, { rightConversion: { kind: "numeric" } }).kind, "ordinary",
    "a converted operand is not erased");
});

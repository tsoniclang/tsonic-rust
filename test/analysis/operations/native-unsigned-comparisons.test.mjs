import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustNativeComparisons } from "../../../dist/analysis/operations/native-comparisons.js";
import { createRustNativeComparisonProducer } from "../../../dist/analysis/program/records/native/native-comparisons.js";
import { planRustNativeZeroComparison } from "../../../dist/backend/planner/expressions/native-zero-comparisons.js";

function select(operator, reversed, value, name, abi) {
  const expression = {}, subject = {}, literal = {}, receiver = {};
  const left = reversed ? literal : subject, right = reversed ? subject : literal;
  const producer = createRustNativeComparisonProducer(() => {});
  const ast = { parent: () => undefined, is: { IsBinaryExpression: node => node === expression, IsIdentifier: () => false,
    IsExpressionStatement: () => false, IsReturnStatement: () => false, IsThrowStatement: () => false,
    IsIfStatement: () => false, IsWhileStatement: () => false, IsDoStatement: () => false,
    IsForOfStatement: () => false, IsForInStatement: () => false,
    IsPropertyAccessExpression: node => node === subject,
    IsStringLiteral: () => false, IsNoSubstitutionTemplateLiteral: () => false, IsParenthesizedExpression: () => false },
    as: { AsBinaryExpression: node => node === expression ? { Left: left, Right: right } : undefined,
      AsPropertyAccessExpression: node => node === subject ? { Expression: receiver } : undefined },
    expression: node => node === subject ? receiver : undefined };
  analyzeRustNativeComparisons({ source: { ast }, records: {
    literalValue: { get: node => node === literal ? { form: "numeric", integer: value } : undefined },
    ...createRustRecordFixture({
      targetOperation: { get: node => node === expression ? { kind: "operator-token", operator }
        : node === subject && abi !== undefined ? { kind: "provider-operation", abi } : undefined },
      valueRead: { get: () => ({ value: { kind: "source-primitive", name } }) },
    }),
  }, ownership: { uses: new Map(), reads: { get: () => undefined } },
    safetyApplications: { operationForExpression: () => undefined } }, [expression], producer);
  return { expression, selected: producer.records.nativeComparison.get(expression), records: producer.records };
}

test("source unsigned boundaries canonicalize both operand orders without folding signed or floating values", () => {
  for (const name of ["uint8", "uint32", "uint64", "native-uint"]) {
    for (const [operator, reversed, normalized] of [["<=", ">=", "=="], [">", "<", "!="]]) {
      for (const swapped of [false, true]) {
        const result = select(swapped ? reversed : operator, swapped, 0n, name);
        assert.deepEqual(result.selected, { kind: "unsigned-zero", operand: swapped ? "right" : "left", operator: normalized, empty: undefined });
        const effect = { kind: "call", path: "next", args: [] }, zero = { kind: "int-literal", text: "0" };
        const rendered = planRustNativeZeroComparison(result.expression, swapped ? zero : effect, swapped ? effect : zero,
          { input: { program: { records: result.records } } });
        assert.equal(rendered.left === effect, true, "the selected effectful operand remains once");
        assert.equal(rendered.operator, normalized);
      }
    }
  }
  for (const name of ["int32", "int64", "float64"]) {
    for (const operator of ["<", ">=", ">", "<="]) assert.equal(select(operator, false, 0n, name).selected.kind, "ordinary", name);
  }
});

test("unsigned impossible bounds preserve the exact evaluation instead of erasing the call", () => {
  for (const [operator, value] of [["<", false], [">=", true]]) {
    const selected = select(operator, false, 0n, "native-uint");
    assert.deepEqual(selected.selected, { kind: "unsigned-constant", operand: "left", value, evaluate: true });
    const effect = { kind: "call", path: "next", args: [] };
    const rendered = planRustNativeZeroComparison(selected.expression, effect, { kind: "int-literal", text: "0" },
      { input: { program: { records: selected.records } } });
    assert.equal(rendered.kind, "evaluate-then");
    assert.equal(rendered.effect === effect, true);
    assert.equal(rendered.value.value, value);
  }
});

test("source one-boundary normalization is exact and does not parse generated token spellings", () => {
  for (const [operator, reversed, normalized] of [["<", ">", "=="], [">=", "<=", "!="]]) {
    for (const swapped of [false, true]) {
      assert.deepEqual(select(swapped ? reversed : operator, swapped, 1n, "native-uint").selected,
        { kind: "unsigned-zero", operand: swapped ? "right" : "left", operator: normalized, empty: undefined });
    }
  }
  for (const operator of ["==", "!=", ">", "<="]) assert.equal(select(operator, false, 1n, "native-uint").selected.kind, "ordinary");
  assert.equal(select("<", false, 2n, "native-uint").selected.kind, "ordinary");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustNativeComparisons } from "../../../dist/analysis/operations/native-comparisons.js";
import { createRustNativeComparisonProducer } from "../../../dist/analysis/program/records/native/native-comparisons.js";

function select(operator, first, second) {
  const expression = {}, left = {}, right = {};
  const producer = createRustNativeComparisonProducer(() => {});
  const literals = new Map([[left, first], [right, second]]);
  const ast = { parent: () => undefined, is: { IsBinaryExpression: node => node === expression, IsParenthesizedExpression: () => false,
    IsIdentifier: () => false, IsStringLiteral: () => false, IsNoSubstitutionTemplateLiteral: () => false },
    as: { AsBinaryExpression: node => node === expression ? { Left: left, Right: right } : undefined } };
  analyzeRustNativeComparisons({ source: { ast }, records: {
    literalValue: { get: node => {
      const value = literals.get(node);
      return value === undefined ? undefined : { form: value ? "true" : "false" };
    } },
    ...createRustRecordFixture({
      targetOperation: { get: node => node === expression ? { kind: "operator-token", operator } : undefined },
      valueRead: { get: () => ({ value: { kind: "source-primitive", name: "bool" } }) },
    }),
  }, ownership: { uses: new Map(), reads: { get: () => undefined } },
    safetyApplications: { operationForExpression: () => undefined } }, [expression], producer);
  return { selection: producer.records.nativeComparison.get(expression), left, right };
}

test("native Boolean comparison decisions preserve every truth-table result before sealing", () => {
  for (const operator of ["==", "!="]) for (const first of [false, true]) for (const second of [false, true]) {
    const { selection } = select(operator, first, second);
    assert.equal(selection.kind, "boolean");
    assert.equal(selection.operand, "right", "the selected right operand is not copied or replaced");
    assert.equal(selection.negated ? !second : second, operator === "==" ? first === second : first !== second);
    assert.equal(Object.isFrozen(selection), true, "the comparison decision is immutable");
  }
});

test("Boolean comparison decisions retain an effectful operand exactly once on either side", () => {
  for (const operator of ["==", "!="]) for (const value of [false, true]) for (const literalFirst of [false, true]) {
    const { selection } = select(operator, literalFirst ? value : undefined, literalFirst ? undefined : value);
    assert.equal(selection.kind, "boolean");
    assert.equal(selection.operand, literalFirst ? "right" : "left");
    assert.equal(selection.negated, operator === "==" ? !value : value);
  }
  assert.equal(select("==", undefined, undefined).selection.kind, "ordinary", "two effects are not folded");
  for (const operator of ["<", "+", "&&", "||"]) {
    assert.equal(select(operator, true, undefined).selection.kind, "ordinary", "non-equality grammar has no Boolean fold");
  }
});

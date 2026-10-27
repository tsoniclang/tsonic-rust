import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustNativeComparisons } from "../../../dist/analysis/operations/native-comparisons.js";
import { createRustNativeComparisonProducer } from "../../../dist/analysis/program/records/native/native-comparisons.js";

function select(operator, first, second, name = "int32", layouts = [], conversions = {}) {
  const expression = {}, left = {}, right = {};
  const producer = createRustNativeComparisonProducer(() => {});
  const literals = new Map([[left, first], [right, second]]);
  const observations = new Map([[left, layouts[0]], [right, layouts[1]]]);
  const ast = { parent: () => undefined, is: { IsBinaryExpression: node => node === expression, IsParenthesizedExpression: () => false,
    IsExpressionStatement: () => false, IsReturnStatement: () => false, IsThrowStatement: () => false,
    IsIfStatement: () => false, IsWhileStatement: () => false, IsDoStatement: () => false,
    IsForOfStatement: () => false, IsForInStatement: () => false, IsPropertyAccessExpression: () => false,
    IsElementAccessExpression: () => false, IsCallExpression: () => false, IsNewExpression: () => false,
    IsAwaitExpression: () => false, IsAsExpression: () => false, IsSatisfiesExpression: () => false,
    IsNonNullExpression: () => false, IsTypeAssertion: () => false, IsDeleteExpression: () => false,
    IsVoidExpression: () => false, IsTypeOfExpression: () => false, IsYieldExpression: () => false,
    IsSpreadElement: () => false, IsExportAssignment: () => false,
    IsIdentifier: () => false, IsStringLiteral: () => false, IsNoSubstitutionTemplateLiteral: () => false },
    as: { AsBinaryExpression: node => node === expression ? { Left: left, Right: right } : undefined } };
  analyzeRustNativeComparisons({ source: { ast }, records: {
    literalValue: { get: node => {
      const integer = literals.get(node);
      return integer === undefined ? undefined : { form: "numeric", integer };
    } },
    ...createRustRecordFixture({
      targetOperation: { get: node => node === expression ? { kind: "operator-token", operator, ...conversions } : undefined },
      nativeHandler: { get: node => {
        const value = observations.get(node);
        return value === undefined ? undefined
          : { kind: "native-pointer", selection: { kind: "layout-query", observation: { value } } };
      } },
      valueRead: { get: () => ({ value: { kind: "source-primitive", name } }) },
    }),
  }, ownership: { uses: new Map(), reads: { get: () => undefined } },
    safetyApplications: { operationForExpression: () => undefined } }, [expression], producer);
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

test("native layout observations use the exact constant comparison before unsigned zero recipes", () => {
  for (const [operator, first, second, value] of [
    ["==", 0n, 0n, true], ["!=", 0n, 0n, false],
    ["<", 0n, 1n, true], [">", 1n, 0n, true],
    ["<=", 1n, 1n, true], [">=", 0n, 1n, false],
  ]) {
    assert.deepEqual(select(operator, undefined, second, "native-uint", [first]),
      { kind: "integer-constant", value }, `${operator}: layout on the left`);
    assert.deepEqual(select(operator, first, undefined, "native-uint", [undefined, second]),
      { kind: "integer-constant", value }, `${operator}: layout on the right`);
    assert.deepEqual(select(operator, undefined, undefined, "native-uint", [first, second]),
      { kind: "integer-constant", value }, `${operator}: two exact layout observations`);
  }
  assert.deepEqual(select("==", undefined, 9007199254740992n, "native-uint", [9007199254740993n]),
    { kind: "integer-constant", value: false }, "native layout values are not rounded through float64");
});

test("native layout comparisons retain unknown operands, conversions and noninteger carriers", () => {
  assert.notEqual(select("==", undefined, undefined, "native-uint", [0n]).kind, "integer-constant",
    "a runtime operand remains evaluated even beside a known layout");
  assert.notEqual(select("==", undefined, undefined, "native-uint", [undefined, 0n]).kind, "integer-constant",
    "an effectful or unknown left input has no compile-time layout proof");
  for (const name of ["float32", "float64"]) {
    assert.notEqual(select("==", undefined, 0n, name, [0n]).kind, "integer-constant", name);
  }
  for (const side of ["leftConversion", "rightConversion"]) {
    assert.notEqual(select("==", undefined, 0n, "native-uint", [0n], { [side]: { kind: "numeric" } }).kind,
      "integer-constant", `${side}: selected native conversions remain authoritative`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceAbsenceReadCarrier, rustSourceAbsenceUse } from "../../../dist/analysis/expressions/absence-use.js";
import { rustOptionTargetType, rustStringTargetType, rustSourceOptionalTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { fakeAstReader } from "../../helpers/fake-compile-input.mjs";

function input(operator, side, wrappers = []) {
  const value = { kind: "KindIdentifier" };
  const other = { kind: "KindIdentifier" };
  const parents = new Map();
  let receiver = value;
  for (const kind of wrappers) {
    const wrapper = { kind, expression: receiver };
    parents.set(receiver, wrapper);
    receiver = wrapper;
  }
  const binary = { kind: "KindBinaryExpression", left: side === "left" ? receiver : other,
    right: side === "right" ? receiver : other, operatorToken: { kind: operator } };
  parents.set(receiver, binary);
  const context = {
    ast: { ...fakeAstReader(), parent: node => parents.get(node), kindName: node => node.kind,
      is: { ...fakeAstReader().is, IsBinaryExpression: node => node.kind === "KindBinaryExpression",
        IsParenthesizedExpression: node => node.kind === "KindParenthesizedExpression",
        IsSatisfiesExpression: node => node.kind === "KindSatisfiesExpression",
        IsWhileStatement: () => false, IsDoStatement: () => false, IsForInStatement: () => false,
        IsAwaitExpression: () => false, IsDeleteExpression: () => false, IsTypeOfExpression: () => false,
        IsYieldExpression: () => false, IsExportAssignment: () => false },
      as: { AsBinaryExpression: node => node.kind === "KindBinaryExpression"
        ? { Left: node.left, Right: node.right, OperatorToken: node.operatorToken } : undefined,
        AsParenthesizedExpression: node => node.kind === "KindParenthesizedExpression"
          ? { Expression: node.expression } : undefined,
        AsSatisfiesExpression: node => node.kind === "KindSatisfiesExpression"
          ? { Expression: node.expression } : undefined } },
    semanticsFor: () => ({ types: { expressionType: () => ({}), isNullish: () => true, isVoidLike: () => false } }),
  };
  return { value, context, parents };
}

test("nullish operands retain absence only for the exact left input through transparent syntax", () => {
  for (const wrappers of [[], ["KindParenthesizedExpression"], ["KindSatisfiesExpression"],
    ["KindParenthesizedExpression", "KindSatisfiesExpression"]]) {
    for (const side of ["left", "right"]) {
      const { value, context } = input("KindQuestionQuestionToken", side, wrappers);
      assert.equal(rustSourceAbsenceUse(value, context), side === "left" ? "coalesce" : undefined, `${side}/${wrappers.join(",")}`);
    }
  }
  for (const operator of ["KindPlusToken", "KindEqualsToken", "KindBarBarToken"]) {
    const { value, context } = input(operator, "left");
    assert.equal(rustSourceAbsenceUse(value, context), undefined, operator);
  }
});

test("coalescing narrows present lanes while preserving only the actual source absence layer", () => {
  const text = rustStringTargetType();
  const optional = rustSourceOptionalTargetType(text);
  assert.equal(rustTargetTypeRefEquals(rustSourceAbsenceReadCarrier(optional, text, "coalesce"), optional), true);
  assert.equal(rustSourceAbsenceReadCarrier(optional, optional, "coalesce") === optional, true);
  assert.equal(rustSourceAbsenceReadCarrier(text, text, "coalesce") === text, true);
  const native = rustOptionTargetType(text);
  assert.equal(rustSourceAbsenceReadCarrier(native, text, "coalesce") === text, true,
    "an explicit native Option is not a manufactured source absence layer");
  const nested = rustOptionTargetType(optional);
  assert.equal(rustSourceAbsenceReadCarrier(nested, optional, "coalesce") === optional, true);
  for (const use of ["comparison", undefined]) {
    assert.equal(rustSourceAbsenceReadCarrier(optional, text, use) === text, true);
  }
  assert.equal(rustSourceAbsenceReadCarrier(optional, undefined, "coalesce"), undefined);
});

test("absence use retains checked nullish comparisons and rejects missing or cyclic syntax", () => {
  for (const operator of ["KindEqualsEqualsToken", "KindExclamationEqualsToken",
    "KindEqualsEqualsEqualsToken", "KindExclamationEqualsEqualsToken"]) {
    for (const side of ["left", "right"]) {
      const { value, context } = input(operator, side);
      assert.equal(rustSourceAbsenceUse(value, context), "comparison");
      context.semanticsFor = () => ({ types: { expressionType: () => ({}), isNullish: () => false, isVoidLike: () => true } });
      assert.equal(rustSourceAbsenceUse(value, context), "comparison");
      context.semanticsFor = () => ({ types: { expressionType: () => ({}), isNullish: () => false, isVoidLike: () => false } });
      assert.equal(rustSourceAbsenceUse(value, context), undefined);
      context.semanticsFor = () => ({ types: { expressionType: () => undefined } });
      assert.equal(rustSourceAbsenceUse(value, context), undefined);
    }
  }
  const { value, context, parents } = input("KindQuestionQuestionToken", "left");
  parents.delete(value);
  assert.equal(rustSourceAbsenceUse(value, context), undefined);
  const cycle = { kind: "KindParenthesizedExpression", expression: value };
  parents.set(value, cycle);
  parents.set(cycle, cycle);
  cycle.expression = cycle;
  assert.equal(rustSourceAbsenceUse(value, context), undefined);
});

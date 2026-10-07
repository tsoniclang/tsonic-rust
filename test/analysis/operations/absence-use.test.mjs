import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceUsePreservesAbsence } from "../../../dist/analysis/expressions/absence-use.js";
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
      assert.equal(rustSourceUsePreservesAbsence(value, context), side === "left", `${side}/${wrappers.join(",")}`);
    }
  }
  for (const operator of ["KindPlusToken", "KindEqualsToken", "KindBarBarToken"]) {
    const { value, context } = input(operator, "left");
    assert.equal(rustSourceUsePreservesAbsence(value, context), false, operator);
  }
});

test("absence use retains checked nullish comparisons and rejects missing or cyclic syntax", () => {
  for (const side of ["left", "right"]) {
    const { value, context } = input("KindEqualsEqualsEqualsToken", side);
    assert.equal(rustSourceUsePreservesAbsence(value, context), true);
    context.semanticsFor = () => ({ types: { expressionType: () => undefined } });
    assert.equal(rustSourceUsePreservesAbsence(value, context), false);
  }
  const { value, context, parents } = input("KindQuestionQuestionToken", "left");
  parents.delete(value);
  assert.equal(rustSourceUsePreservesAbsence(value, context), false);
  const cycle = { kind: "KindParenthesizedExpression", expression: value };
  parents.set(value, cycle);
  parents.set(cycle, cycle);
  cycle.expression = cycle;
  assert.equal(rustSourceUsePreservesAbsence(value, context), false);
});

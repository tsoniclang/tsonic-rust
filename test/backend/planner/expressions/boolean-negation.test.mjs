import assert from "node:assert/strict";
import test from "node:test";
import { negateRustBooleanExpression } from "../../../../dist/backend/target-ast/syntax/expressions.js";
import { mapRustExpressionChildren } from "../../../../dist/backend/target-ast/syntax/expression-children.js";
import { rustItemsReferenceModuleAlias } from "../../../../dist/backend/target-ast/syntax/module-references.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

test("boolean negation preserves ordinary selected methods regardless of spelling", () => {
  for (const method of ["is_some", "is_none", "is_ready"]) {
    const expression = { kind: "method-call", receiver: { kind: "call", path: "probes::next", args: [] },
      method, args: [], receiverMode: "mut-ref" };
    const negated = negateRustBooleanExpression(expression);
    assert.deepEqual(negated, { kind: "unary", operator: "!", operand: expression });
    assert.equal(negated.operand === expression, true, "the selected effect is retained once");
    assert.equal(printRustExpr(negated), `!probes::next().${method}()`);
    assert.equal(negateRustBooleanExpression(negated) === expression, true, "double negation keeps the exact operand");
    const conjunction = { kind: "binary", operator: "&&", left: expression, right: { kind: "bool-literal", value: true } };
    const inverted = negateRustBooleanExpression(conjunction);
    assert.equal(inverted.operator, "||");
    assert.equal(inverted.left.operand === expression, true, "De Morgan keeps the selected left effect exactly once");
    assert.deepEqual(inverted.right, { kind: "bool-literal", value: false });
  }
});

test("explicit native Option presence keeps its exact receiver and absence meaning", () => {
  const receiver = { kind: "call", path: "values::next", args: [] };
  for (const present of [true, false]) {
    const expression = { kind: "option-presence", receiver, present };
    const negated = negateRustBooleanExpression(expression);
    assert.equal(negated.receiver === receiver, true, "the exact Option receiver is evaluated once");
    assert.equal(negated.present, !present);
    assert.equal(printRustExpr(expression), `values::next().${present ? "is_some" : "is_none"}()`);
    assert.equal(printRustExpr(negated), `values::next().${present ? "is_none" : "is_some"}()`);
    assert.deepEqual(negateRustBooleanExpression(negated), expression);
    const children = [];
    const mapped = mapRustExpressionChildren(expression, child => { children.push(child); return child; });
    assert.deepEqual(children, [receiver]);
    assert.equal(mapped.receiver === receiver, true, "native syntax mapping preserves the one selected receiver");
    const items = [{ kind: "const", name: "PRESENT", visibility: "private", type: { kind: "primitive", name: "bool" }, value: expression }];
    assert.equal(rustItemsReferenceModuleAlias(items, "values"), true);
    assert.equal(rustItemsReferenceModuleAlias(items, "unrelated"), false);
  }
});

test("negation inverts native equality and disjunction without changing either operand", () => {
  const left = { kind: "call", path: "left", args: [] };
  const right = { kind: "call", path: "right", args: [] };
  for (const operator of ["==", "!=", "||"]) {
    const inverted = negateRustBooleanExpression({ kind: "binary", operator, left, right });
    assert.equal(inverted.operator, operator === "==" ? "!=" : operator === "!=" ? "==" : "&&");
    assert.equal((operator === "||" ? inverted.left.operand : inverted.left) === left, true, operator + ": left identity");
    assert.equal((operator === "||" ? inverted.right.operand : inverted.right) === right, true, operator + ": right identity");
  }
});

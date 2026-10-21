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
    assert.equal(printRustExpr(negateRustBooleanExpression(negated)), `!!probes::next().${method}()`);
    const conjunction = { kind: "binary", operator: "&&", left: expression, right: { kind: "bool-literal", value: true } };
    assert.equal(negateRustBooleanExpression(conjunction).operand === conjunction, true,
      "the syntax constructor does not decide or reorder Boolean operations");
  }
});

test("explicit native Option presence keeps its exact receiver and absence meaning", () => {
  const receiver = { kind: "call", path: "values::next", args: [] };
  for (const present of [true, false]) {
    const expression = { kind: "option-presence", receiver, present };
    const negated = negateRustBooleanExpression(expression);
    assert.equal(negated.operand === expression, true, "negation cannot substitute another operation");
    assert.equal(printRustExpr(expression), `values::next().${present ? "is_some" : "is_none"}()`);
    assert.equal(printRustExpr(negated), `!values::next().${present ? "is_some" : "is_none"}()`);
    const children = [];
    const mapped = mapRustExpressionChildren(expression, child => { children.push(child); return child; });
    assert.deepEqual(children, [receiver]);
    assert.equal(mapped.receiver === receiver, true, "native syntax mapping preserves the one selected receiver");
    const items = [{ kind: "const", name: "PRESENT", visibility: "private", type: { kind: "primitive", name: "bool" }, value: expression }];
    assert.equal(rustItemsReferenceModuleAlias(items, "values"), true);
    assert.equal(rustItemsReferenceModuleAlias(items, "unrelated"), false);
  }
});

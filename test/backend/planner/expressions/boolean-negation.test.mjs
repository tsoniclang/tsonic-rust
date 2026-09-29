import assert from "node:assert/strict";
import { test } from "node:test";
import {
  negateRustBooleanExpression,
  rustExpressionContainsStatementBlock,
} from "../../../../dist/backend/target-ast/expressions.js";
import {
  rustExpressionChildren,
  rustExpressionReferencesPath,
} from "../../../../dist/backend/target-ast/inspection/source-usage.js";
import { rustItemsReferenceModuleAlias } from "../../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { rustExpressionUsesTryInCurrentRegion } from "../../../../dist/backend/planner/types/fallible-shape.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

test("boolean negation preserves ordinary selected methods regardless of spelling", () => {
  for (const method of ["is_some", "is_none", "is_ready"]) {
    const expression = {
      kind: "method-call",
      receiver: { kind: "call", path: "probes::next", args: [] },
      method,
      args: [],
      receiverMode: "mut-ref",
    };
    const negated = negateRustBooleanExpression(expression);
    assert.deepEqual(negated, { kind: "unary", operator: "!", operand: expression });
    assert.equal(negated.operand, expression);
    assert.equal(printRustExpr(negated), `!probes::next().${method}()`);
    assert.equal(negateRustBooleanExpression(negated), expression);
    const conjunction = negateRustBooleanExpression({
      kind: "binary",
      operator: "&&",
      left: expression,
      right: { kind: "bool-literal", value: true },
    });
    assert.equal(conjunction.operator, "||");
    assert.equal(conjunction.left.operand, expression);
    assert.deepEqual(conjunction.right, { kind: "bool-literal", value: false });
  }
});

test("only explicit native Option presence nodes invert their predicate", () => {
  const receiver = { kind: "call", path: "values::next", args: [] };
  for (const present of [true, false]) {
    const expression = { kind: "option-presence", receiver, present };
    const negated = negateRustBooleanExpression(expression);
    assert.deepEqual(negated, { ...expression, present: !present });
    assert.equal(negated.receiver, receiver);
    assert.equal(printRustExpr(expression), `values::next().${present ? "is_some" : "is_none"}()`);
    assert.equal(printRustExpr(negated), `values::next().${present ? "is_none" : "is_some"}()`);
    assert.deepEqual(negateRustBooleanExpression(negated), expression);
  }
});

test("native Option predicates retain receiver regions, dependencies and normalization", () => {
  const receiver = {
    kind: "block",
    bindings: [],
    value: {
      kind: "try",
      expr: {
        kind: "call",
        path: "values::next",
        args: [{ kind: "path", path: "seed" }],
      },
    },
  };
  const expression = { kind: "option-presence", receiver, present: true };
  assert.deepEqual(rustExpressionChildren(expression), [receiver]);
  assert.equal(rustExpressionContainsStatementBlock(expression), true);
  assert.equal(rustExpressionUsesTryInCurrentRegion(expression), true);
  assert.equal(rustExpressionReferencesPath(expression, "seed"), true);
  const model = {
    headerComment: "",
    items: [{
      kind: "const",
      name: "PRESENT",
      visibility: "private",
      type: { kind: "primitive", name: "bool" },
      value: expression,
    }],
  };
  assert.equal(rustItemsReferenceModuleAlias(model.items, "values"), true);
  assert.equal(rustItemsReferenceModuleAlias(model.items, "unrelated"), false);
  const normalized = finalizeRustSourceStyle(model).items[0].value;
  assert.equal(normalized.kind, "option-presence");
  assert.equal(normalized.present, true);
  assert.equal(rustExpressionUsesTryInCurrentRegion(normalized), true);
  assert.equal(rustItemsReferenceModuleAlias([{ ...model.items[0], value: normalized }], "values"), true);
  assert.equal(rustExpressionUsesTryInCurrentRegion({
    kind: "option-presence",
    receiver: { kind: "path", path: "plain" },
    present: false,
  }), false);
});

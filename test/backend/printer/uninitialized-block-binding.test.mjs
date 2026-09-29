import assert from "node:assert/strict";
import test from "node:test";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { rustExpressionChildren, rustExpressionReferencesPath } from "../../../dist/backend/target-ast/inspection/source-usage.js";
import { firstAccessesInStatements, maxWritesInStatements } from "../../../dist/backend/target-ast/inspection/source-dataflow.js";

test("native block lets preserve definite assignment, lexical shadowing and external writes", () => {
  const path = name => ({ kind: "path", path: name });
  const expression = {
    kind: "block",
    bindings: [{ name: "result", type: { kind: "primitive", name: "i32" } }],
    value: {
      kind: "evaluate-then", discard: "unit",
      effect: { kind: "assignment", operator: "=", target: path("result"), value: path("input") },
      value: {
        kind: "evaluate-then", discard: "unit",
        effect: { kind: "assignment", operator: "=", target: path("output"), value: path("result") },
        value: path("result"),
      },
    },
  };
  assert.match(printRustExpr(expression), /^\{ let result: i32; /);
  assert.equal(rustExpressionReferencesPath(expression, "result"), false);
  assert.equal(rustExpressionReferencesPath(expression, "input"), true);
  assert.equal(rustExpressionReferencesPath(expression, "output"), true);
  assert.deepEqual(rustExpressionChildren(expression), [expression.value]);
  const statements = [{ kind: "expr", expr: expression }];
  assert.equal(maxWritesInStatements(statements, "result"), 0);
  assert.equal(maxWritesInStatements(statements, "output"), 1);
  assert.deepEqual([...firstAccessesInStatements(statements, "input")], ["read"]);
  assert.deepEqual([...firstAccessesInStatements(statements, "result")], ["none"]);
});

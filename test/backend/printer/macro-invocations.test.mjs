import assert from "node:assert/strict";
import test from "node:test";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { rustExpressionChildren } from "../../../dist/backend/target-ast/inspection/source-usage.js";

test("one macro AST preserves list and repetition syntax and exact operand traversal", () => {
  const first = { kind: "call", path: "element", args: [] };
  const count = { kind: "call", path: "count", args: [] };
  const repeated = { kind: "macro-invocation", path: "alloc::vec", delimiter: "brackets", arguments: "repeat", args: [first, count] };
  assert.equal(printRustExpr(repeated), "alloc::vec![element(); count()]");
  assert.deepEqual(rustExpressionChildren(repeated), [first, count]);
  assert.equal(printRustExpr({ ...repeated, arguments: "list" }), "alloc::vec![element(), count()]");
  assert.equal(printRustExpr({ ...repeated, arguments: "list", args: [] }), "alloc::vec![]");
  for (const args of [[], [first], [first, count, first]]) {
    assert.throws(() => printRustExpr({ ...repeated, args }), /two/u);
  }
});

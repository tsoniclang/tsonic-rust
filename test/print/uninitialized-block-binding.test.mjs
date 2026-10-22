import { rustValueBlock } from "../../../dist/backend/target-ast/syntax/value-block.js";
import assert from "node:assert/strict";
import test from "node:test";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { mapRustExpressionChildren } from "../../../dist/backend/target-ast/syntax/expression-children.js";

test("native block lets preserve explicit type, lexical scope and external writes", () => {
  const path = name => ({ kind: "path", path: name });
  const expression = rustValueBlock([{ name: "result", type: { kind: "primitive", name: "i32" } }], {
    kind: "evaluate-then", discard: "unit",
    effect: { kind: "assignment", operator: "=", target: path("result"), value: path("input") },
    value: { kind: "evaluate-then", discard: "unit",
      effect: { kind: "assignment", operator: "=", target: path("output"), value: path("result") }, value: path("result") },
  });
  const text = printRustExpr(expression);
  assert.match(text, /^\{ let result: i32; /u);
  assert.match(text, /result = input/u);
  assert.match(text, /output = result/u);
  assert.equal(text.indexOf("result = input") < text.indexOf("output = result"), true, "native evaluation order is unchanged");
  const blocks = [];
  const mapped = mapRustExpressionChildren(expression, child => child, body => { blocks.push(body); return body; });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0] === expression.body && mapped.body === expression.body, true, "the canonical block is mapped intact");
});

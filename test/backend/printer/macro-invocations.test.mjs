import assert from "node:assert/strict";
import test from "node:test";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { rustExpressionChildren } from "../../../dist/backend/target-ast/inspection/source-usage.js";
import { rustSeparatedExpressionTokens } from "../../../dist/backend/target-ast/macro-input.js";
import { printRustTokenStream } from "../../../dist/print/source/macro-input.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";

test("one macro AST preserves list and repetition syntax and exact operand traversal", () => {
  const first = { kind: "call", path: "element", args: [] };
  const count = { kind: "call", path: "count", args: [] };
  const repeated = { kind: "macro-invocation", path: "alloc::vec", input: {
    delimiter: "brackets", tokens: rustSeparatedExpressionTokens([first, count], ";"),
  } };
  assert.equal(printRustExpr(repeated), "alloc::vec![element() ; count()]");
  assert.deepEqual(rustExpressionChildren(repeated), [first, count]);
  assert.equal(printRustExpr({ ...repeated, input: {
    delimiter: "brackets", tokens: rustSeparatedExpressionTokens([first, count], ","),
  } }), "alloc::vec![element() , count()]");
  assert.equal(printRustExpr({ ...repeated, input: {
    delimiter: "brackets", tokens: [],
  } }), "alloc::vec![]");
});

test("macro input preserves all delimiters, raw identifiers and exact native literals", () => {
  const tokens = [
    { kind: "identifier", text: "type", raw: true },
    { kind: "punctuation", text: "=", joint: true },
    { kind: "punctuation", text: ">", joint: false },
    { kind: "group", delimiter: "parentheses", tokens: [
      { kind: "literal", text: 'r##"native \\ text"##' },
      { kind: "punctuation", text: ",", joint: false },
      { kind: "group", delimiter: "brackets", tokens: [
        { kind: "literal", text: "9007199254740993_u64" },
      ] },
    ] },
  ];
  assert.equal(printRustExpr({ kind: "macro-invocation", path: "fixture::syntax", input: {
    delimiter: "braces", tokens,
  } }), 'fixture::syntax!{r#type => (r##"native \\ text"## , [9007199254740993_u64])}');
});

test("macro punctuation retains joint versus separated tokens", () => {
  const punctuation = (text, joint) => ({ kind: "punctuation", text, joint });
  assert.equal(printRustTokenStream([punctuation("-", true), punctuation(">", false)]), "->");
  assert.equal(printRustTokenStream([punctuation("-", false), punctuation(">", false)]), "- >");
  assert.equal(printRustTokenStream([
    punctuation("'", true), { kind: "identifier", text: "scope", raw: false },
  ]), "'scope");
  assert.equal(printRustTokenStream([
    punctuation("&", false), punctuation("&", false),
  ]), "& &");
});

test("macro input uses the existing printers for exact typed fragments", () => {
  const fragments = [
    { kind: "type", type: { kind: "reference", mutable: false, referent: { kind: "primitive", name: "u8" } } },
    { kind: "pattern", pattern: { kind: "binding", name: "item" } },
    { kind: "lifetime", lifetime: { kind: "named", name: "input" } },
    { kind: "const", value: { kind: "integer", value: 9007199254740993n } },
  ];
  assert.equal(printRustTokenStream(fragments.map(fragment => ({ kind: "fragment", fragment }))),
    "&u8 item 'input 9007199254740993");
});

test("post-evidence humanization cannot change macro-observable input syntax", () => {
  const comparison = {
    kind: "binary", operator: "==",
    left: { kind: "path", path: "value" }, right: { kind: "bool-literal", value: true },
  };
  const invocation = { kind: "macro-invocation", path: "fixture::observe", input: {
    delimiter: "parentheses", tokens: rustSeparatedExpressionTokens([comparison], ","),
  } };
  const model = finalizeRustSourceStyle({ headerComment: "fixture", items: [{
    kind: "const", name: "VALUE", visibility: "private",
    type: { kind: "primitive", name: "bool" }, value: invocation,
  }] });
  assert.equal(model.items[0].value, invocation);
  assert.equal(printRustExpr(invocation), "fixture::observe!(value == true)");
});

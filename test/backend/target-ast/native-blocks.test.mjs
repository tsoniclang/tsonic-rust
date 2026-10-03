import assert from "node:assert/strict";
import test from "node:test";
import { rustValueBlock } from "../../../dist/backend/target-ast/value-block.js";
import { mapRustExpressionChildren } from "../../../dist/backend/target-ast/expression-children.js";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { printRustBlockStatements } from "../../../dist/print/source/blocks.js";
import { applyFallibleShape } from "../../../dist/backend/planner/types/fallible-shape.js";
import { rustBlockTerminates } from "../../../dist/backend/planner/statements/block-flow.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { rustExpressionExitsCallable } from "../../../dist/backend/target-ast/inspection/callable-exits.js";
import { rustExpressionAlwaysExits, firstAccessesInStatements } from "../../../dist/backend/target-ast/inspection/source-dataflow.js";

const path = name => ({ kind: "path", path: name });
const unit = { kind: "tuple-literal", elements: [] };
const pattern = { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "value" }] };
const block = (...statements) => ({ kind: "block", body: { statements } });
const options = { fallible: true, hasReturnValue: true, errorType: { kind: "primitive", name: "i32" }, inferErrorTypeFromReturnType: true };

test("one native block shape preserves binding, body and terminal attributes", () => {
  const binding = { kind: "word", path: "binding_attribute" };
  const inner = { kind: "word", path: "body_attribute" };
  const terminal = { kind: "word", path: "terminal_attribute" };
  const expression = rustValueBlock([{ name: "value", value: path("input"), attrs: [binding] }], path("value"),
    { inner: [inner], value: [terminal] });
  assert.deepEqual(expression.body.innerAttrs, [inner]);
  assert.deepEqual(expression.body.statements[0].attrs, [binding]);
  assert.deepEqual(expression.body.statements[1].attrs, [terminal]);
  const printed = printRustExpr(expression);
  assert.match(printed, /#!\[body_attribute\]/u);
  assert.match(printed, /#\[binding_attribute\][\s\S]*let value = input;/u);
  assert.match(printed, /#\[terminal_attribute\][\s\S]*value \}/u);
  assert.equal("bindings" in expression, false);
  assert.equal("value" in expression, false);
});

test("native block and generic if-let reject superseded representations", () => {
  assert.throws(() => printRustExpr({ kind: "block", bindings: [], value: unit }), /canonical native statement body/u);
  assert.throws(() => printRustBlockStatements({ statements: [{ kind: "if-let-some", binding: "value", expression: path("source"), body: { statements: [] } }] }, 0),
    /Unsupported Rust statement/u);
});

test("generic if-let keeps arbitrary native statements and direct loop exits", () => {
  const expression = { kind: "if-let", pattern, expression: path("source"), whenTrue: block(
    { kind: "let", name: "copy", mutable: false, init: path("value") },
    { kind: "continue", label: "outer" },
  ), whenFalse: block({ kind: "break", label: "outer" }) };
  const printed = printRustExpr(expression);
  assert.match(printed, /^if let Some\(value\) = source \{/u);
  assert.match(printed, /continue 'outer;/u);
  assert.match(printed, /else \{ break 'outer; \}/u);
  assert.doesNotMatch(printed, /\|\||closure|unwrap/u);
});

test("generic if-let else chains preserve native structure without lifting attributed scopes", () => {
  const nested = { kind: "if", condition: path("ready"), then: { statements: [{ kind: "expr", expr: path("act") }] } };
  const expression = { kind: "if-let", pattern, expression: path("source"), whenTrue: unit, whenFalse: block(nested) };
  assert.match(printRustExpr(expression), /else if ready \{/u);
  assert.match(printRustExpr({ ...expression, whenFalse: { kind: "block", body: { innerAttrs: [{ kind: "word", path: "scope_attribute" }], statements: [nested] } } }),
    /else \{ #!\[scope_attribute\]/u);
});

test("native fallible shaping follows expression operands but never deferred callable regions", () => {
  const early = block({ kind: "return", expr: path("answer") });
  const closure = { kind: "closure-block", params: [], move: false, async: false, body: early.body };
  const source = { innerAttrs: [{ kind: "word", path: "outer_attribute" }], statements: [
    { kind: "let", name: "argument", mutable: false, init: { kind: "call", path: "consume", args: [early] } },
    { kind: "expr", expr: closure },
    { kind: "tail", attrs: [{ kind: "word", path: "tail_attribute" }], expr: path("argument") },
  ] };
  const shaped = applyFallibleShape(source, options);
  assert.deepEqual(shaped.innerAttrs, source.innerAttrs);
  const returned = shaped.statements[0].init.args[0].body.statements[0].expr;
  assert.deepEqual(returned, { kind: "call", path: "Ok", args: [path("answer")] });
  assert.equal(shaped.statements[1].expr, closure);
  assert.deepEqual(shaped.statements[2].attrs, source.statements[2].attrs);
  assert.match(printRustBlockStatements(shaped, 0), /return Ok\(answer\);/u);
});

test("raw value-block tails and each explicit early return have distinct result ownership", () => {
  const expression = block({ kind: "expr", expr: { kind: "if-let", pattern, expression: path("source"),
    whenTrue: block({ kind: "return", expr: path("value") }) } }, { kind: "tail", expr: path("fallback") });
  const shaped = applyFallibleShape({ statements: [{ kind: "tail", expr: expression }] }, options);
  const printed = printRustBlockStatements(shaped, 0);
  assert.match(printed, /^Ok\(\{ if let Some\(value\) = source \{ return Ok\(value\); \} fallback \}\)$/u);
  assert.doesNotMatch(printed, /Ok\(fallback\)|Ok\(Ok\(/u);
});

test("completion knows native branch exits without inventing returns in partial or deferred branches", () => {
  const returned = block({ kind: "return", expr: path("answer") });
  const expression = { kind: "if-let", pattern, expression: path("source"), whenTrue: returned, whenFalse: returned };
  assert.equal(rustExpressionExitsCallable(expression), true);
  assert.equal(rustExpressionAlwaysExits(expression), true);
  assert.equal(rustBlockTerminates({ statements: [{ kind: "expr", expr: expression }] }), true);
  assert.equal(rustExpressionAlwaysExits({ ...expression, whenFalse: undefined }), false);
  assert.equal(rustExpressionAlwaysExits({ kind: "binary", operator: "&&", left: path("ready"), right: returned }), false);
  assert.equal(rustExpressionAlwaysExits({ kind: "closure", params: [], body: returned }), false);
  assert.equal(rustExpressionAlwaysExits(block({ kind: "tail", expr: path("answer") })), false);
  assert.deepEqual([...firstAccessesInStatements([{ kind: "expr", expr: expression }, { kind: "expr", expr: path("later") }], "later")], ["exit"]);
});

test("native AST child mapping and source normalization use the same canonical block recursion", () => {
  const expression = block({ kind: "tail", expr: { kind: "call", path: "consume", args: [path("input")] } });
  const changed = mapRustExpressionChildren(expression, value => value, body => ({ ...body, statements: [...body.statements, { kind: "expr", expr: path("after") }] }));
  assert.equal(changed.body.statements.length, 2);
  const normalized = finalizeRustSourceStyle({ items: [{ kind: "function", name: "run", visibility: "public", params: [], generics: emptyRustGenerics,
    body: { statements: [{ kind: "tail", expr: expression }] } }] });
  assert.deepEqual(finalizeRustSourceStyle(normalized), normalized);
  assert.equal(normalized.items[0].body.statements[0].expr.kind, "block");
});

test("native receiver evidence retains mutable sequence construction, including immediate callback captures", () => {
  const source = { items: [{ kind: "function", name: "run", visibility: "public", params: [], generics: emptyRustGenerics,
    body: { statements: [{ kind: "tail", expr: rustValueBlock([{ name: "values", mutable: true,
      type: { kind: "named", path: "Vec", genericArguments: [{ kind: "type", type: { kind: "string" } }] },
      value: { kind: "vec-literal", elements: [] } }], { kind: "evaluate-then", discard: "unit",
      effect: { kind: "call", path: "with_values", args: [{ kind: "closure", params: [], body: {
        kind: "method-call", receiver: path("values"), receiverMode: "mut-ref", method: "extend_from_slice", args: [path("source")],
      } }] }, value: path("values") }) }] } }] };
  const normalized = finalizeRustSourceStyle(source);
  assert.equal(normalized.items[0].body.statements[0].expr.body.statements[0].mutable, true);
  const readOnly = structuredClone(source);
  readOnly.items[0].body.statements[0].expr.body.statements[1].expr.effect.args[0].body.receiverMode = "ref";
  assert.equal(finalizeRustSourceStyle(readOnly).items[0].body.statements[0].expr.body.statements[0].mutable, false);
  const unknown = structuredClone(source);
  delete unknown.items[0].body.statements[0].expr.body.statements[1].expr.effect.args[0].body.receiverMode;
  assert.equal(finalizeRustSourceStyle(unknown).items[0].body.statements[0].expr.body.statements[0].mutable, true);
  const direct = structuredClone(source);
  direct.items[0].body.statements[0].expr.body.statements[1].expr.effect =
    direct.items[0].body.statements[0].expr.body.statements[1].expr.effect.args[0].body;
  assert.equal(finalizeRustSourceStyle(direct).items[0].body.statements[0].expr.body.statements[0].mutable, true);
});

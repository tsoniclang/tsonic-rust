import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";
import { mapRustExpressionChildren } from "../../../../dist/backend/target-ast/syntax/expression-children.js";
import { rustItemsReferenceModuleAlias } from "../../../../dist/backend/target-ast/syntax/module-references.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

const unit = { kind: "tuple-literal", elements: [] };
const path = name => ({ kind: "path", path: name });
const pattern = { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "value" }] };
const consume = { kind: "call", path: "consume", args: [path("value")] };

test("selected native optional syntax retains recursive single evaluation and stable formatting", () => {
  const selected = { kind: "if-let", pattern, expression: { kind: "call", path: "source", args: [] }, whenTrue: consume };
  assert.equal(printRustExpr(selected), "if let Some(value) = source() { consume(value) }");
  const nested = { ...selected, whenTrue: selected };
  const model = { items: [{ kind: "function", name: "run", visibility: "public", generics: emptyRustGenerics,
    params: [], body: { statements: [{ kind: "tail", expr: nested }] } }] };
  const normalized = finalizeRustSourceStyle(model);
  const expression = normalized.items[0].body.statements[0].expr;
  assert.equal(expression.kind, "if-let");
  assert.equal(expression.whenTrue.kind, "if-let");
  assert.equal((printRustExpr(expression).match(/source\(\)/gu) ?? []).length, 2);
  assert.deepEqual(finalizeRustSourceStyle(normalized), normalized);
  assert.doesNotMatch(JSON.stringify(expression), /closure|single_match|allow|unwrap/u);
});

test("native optional fallback effects and selected patterns are printed without reinterpretation", () => {
  const selected = { kind: "if-let", pattern, expression: path("source"), whenTrue: consume,
    whenFalse: { kind: "call", path: "fallback", args: [] } };
  assert.equal(printRustExpr(selected), "if let Some(value) = source { consume(value) } else { fallback() }");
  const other = { ...selected, pattern: { ...pattern, path: "domain::Selected" } };
  assert.match(printRustExpr(other), /^if let domain::Selected\(value\)/u);
});

test("native if-let mapping preserves selected arms, effects and module paths", () => {
  const assignment = { kind: "assignment", target: path("result"), operator: "=", value: { kind: "int-literal", text: "1" } };
  const expression = { kind: "if-let", pattern, expression: path("source"), whenTrue: assignment, whenFalse: assignment };
  const children = [];
  const mapped = mapRustExpressionChildren(expression, child => { children.push(child); return child; }, block => block);
  assert.deepEqual(children, [expression.expression, assignment, assignment]);
  assert.equal(mapped.whenTrue === assignment && mapped.whenFalse === assignment, true, "both selected branches keep their exact write");
  const item = { kind: "function", name: "run", visibility: "public", generics: emptyRustGenerics, params: [],
    body: { statements: [{ kind: "tail", expr: { ...expression, pattern: { ...pattern, path: "domain::Selected" } } }] } };
  assert.equal(rustItemsReferenceModuleAlias([item], "domain"), true);
  assert.equal(rustItemsReferenceModuleAlias([item], "other"), false);
  assert.equal(printRustExpr({ ...expression, whenTrue: path("value"), whenFalse: unit,
    pattern: { ...pattern, path: "domain::Selected" } }),
    "if let domain::Selected(value) = source { value } else {  }");
});

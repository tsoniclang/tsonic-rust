import assert from "node:assert/strict";
import test from "node:test";
import { applyFallibleShape, applyRustFallibleResultExpression } from "../../../../dist/backend/planner/types/fallible-shape.js";
import { rustItemsReferenceModuleAlias } from "../../../../dist/backend/target-ast/syntax/module-references.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

test("native fallible rendering uses the selected result carrier without rediscovering exits", () => {
  const errorType = { kind: "primitive", name: "i32" };
  const propagation = { kind: "try", expr: { kind: "path", path: "outcome" }, nativeReturn: true,
    resultErrorType: errorType, operandErrorType: errorType };
  const rendered = applyRustFallibleResultExpression(propagation, { errorType });
  assert.equal(rendered.path, "Ok");
  assert.equal(rendered.args[0] === propagation, true, "the selected native propagation remains exactly once");
  assert.deepEqual(rendered.genericArguments, [{ kind: "type", type: { kind: "infer" } }, { kind: "type", type: errorType }]);
});

test("native async and closure syntax preserve deferred returns and exact captured writes", () => {
  const returned = { kind: "return", expr: { kind: "call", path: "rt::complete", args: [] } };
  const future = { kind: "async-block", move: true, body: { statements: [
    { kind: "assign", target: { kind: "path", path: "captured" }, operator: "=", value: { kind: "int-literal", text: "1" } },
    returned,
  ] } };
  const closure = { kind: "closure-block", params: [], move: false, async: false, body: { statements: [returned] } };
  const body = { statements: [{ kind: "expr", expr: future }, { kind: "expr", expr: closure }] };
  const shaped = applyFallibleShape(body, { fallible: true, hasReturnValue: true,
    errorType: { kind: "primitive", name: "i32" }, inferErrorTypeFromReturnType: true, canFallThrough: true });
  assert.equal(shaped.statements[0].expr === future, true, "outer returns never rewrite the deferred async body");
  assert.equal(shaped.statements[1].expr === closure, true, "outer returns never rewrite an authored closure");
  const text = printRustExpr(future);
  assert.match(text, /^async move \{/u);
  assert.match(text, /captured = 1/u);
  assert.match(text, /return rt::complete\(\)/u);
  assert.doesNotMatch(text, /\|\||\}\)\(\)/u);
  assert.equal(rustItemsReferenceModuleAlias([{ kind: "function", name: "create", visibility: "private",
    generics: { parameters: [], wherePredicates: [] }, params: [], body }], "rt"), true);
});

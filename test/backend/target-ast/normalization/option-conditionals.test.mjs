import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRustOptionalUnitMatch } from "../../../../dist/backend/target-ast/normalization/option-conditionals.js";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/nodes.js";
import { rustExpressionChildren, rustExpressionReferencesPath } from "../../../../dist/backend/target-ast/inspection/source-usage.js";
import { maxWritesInStatements, firstAccessesInStatements } from "../../../../dist/backend/target-ast/inspection/source-dataflow.js";
import { rustItemsReferenceModuleAlias } from "../../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { rustExpressionExitsCallable } from "../../../../dist/backend/target-ast/inspection/callable-exits.js";
import { rustExpressionUsesTryInCurrentRegion } from "../../../../dist/backend/planner/types/fallible-shape.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

const unit = { kind: "tuple-literal", elements: [] };
const path = name => ({ kind: "path", path: name });
const pattern = { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "value" }] };
const consume = { kind: "call", path: "consume", args: [path("value")] };
const selection = { kind: "match", expression: { kind: "call", path: "source", args: [] }, arms: [
  { pattern, expression: consume }, { pattern: { kind: "path", path: "None" }, expression: unit },
] };

test("native optional unit match normalization is recursive, single-evaluation and idempotent", () => {
  const selected = normalizeRustOptionalUnitMatch(selection);
  assert.deepEqual(selected, { kind: "if-let", pattern, expression: selection.expression, whenTrue: consume });
  assert.equal(printRustExpr(selected), "if let Some(value) = source() { consume(value) }");
  const nested = { ...selection, arms: [{ pattern, expression: selection }, selection.arms[1]] };
  const model = { items: [{ kind: "function", name: "run", visibility: "public", generics: emptyRustGenerics,
    params: [], body: { statements: [{ kind: "tail", expr: nested }] } }] };
  const normalized = finalizeRustSourceStyle(model);
  const expression = normalized.items[0].body.statements[0].expr;
  assert.equal(expression.kind, "if-let");
  assert.equal(expression.whenTrue.kind, "if-let");
  assert.equal(printRustExpr(expression).match(/source\(\)/gu).length, 2);
  assert.deepEqual(finalizeRustSourceStyle(normalized), normalized);
  assert.doesNotMatch(JSON.stringify(expression), /closure|single_match|allow|unwrap/u);
});

test("only the exact optional absence-unit relation is normalized; effectful fallback remains live", () => {
  for (const expression of [
    { ...selection, arms: [selection.arms[1], selection.arms[0]] },
    { ...selection, arms: [{ ...selection.arms[0], pattern: { ...pattern, path: "other::Some" } }, selection.arms[1]] },
    { ...selection, arms: [selection.arms[0], { ...selection.arms[1], expression: { kind: "call", path: "fallback", args: [] } }] },
    { ...selection, arms: [selection.arms[0], { ...selection.arms[1], pattern: { kind: "wildcard" } }] },
    { ...selection, arms: [...selection.arms, selection.arms[1]] },
  ]) assert.equal(normalizeRustOptionalUnitMatch(expression), expression);
});

test("native if-let visitors preserve branch-local bindings, mutually exclusive writes, effects and paths", () => {
  const assignment = { kind: "assignment", target: path("result"), operator: "=", value: { kind: "int-literal", text: "1" } };
  const expression = { kind: "if-let", pattern, expression: path("source"), whenTrue: assignment, whenFalse: assignment };
  assert.deepEqual(rustExpressionChildren(expression), [expression.expression, assignment, assignment]);
  assert.equal(maxWritesInStatements([{ kind: "tail", expr: expression }], "result"), 1);
  assert.deepEqual([...firstAccessesInStatements([{ kind: "tail", expr: expression }], "result")], ["write"]);
  const shadow = { ...expression, whenTrue: path("value"), whenFalse: undefined };
  assert.equal(rustExpressionReferencesPath(shadow, "value"), false);
  assert.equal(rustExpressionReferencesPath({ ...shadow, whenFalse: path("value") }, "value"), true);
  const branchWrite = { ...assignment, target: path("value") };
  assert.equal(maxWritesInStatements([{ kind: "tail", expr: { ...shadow, whenTrue: branchWrite } }], "value"), 0);
  const returned = { ...shadow, whenTrue: { kind: "return-expression", expr: path("value") } };
  assert.equal(rustExpressionExitsCallable(returned), true);
  const propagation = { kind: "try", expr: path("outcome"), resultErrorType: { kind: "primitive", name: "i32" },
    operandErrorType: { kind: "primitive", name: "i32" } };
  assert.equal(rustExpressionUsesTryInCurrentRegion({ ...shadow, whenTrue: propagation }), true);
  assert.equal(rustExpressionUsesTryInCurrentRegion({ ...shadow, whenTrue: { kind: "closure", params: [], body: propagation } }), false);
  const item = { kind: "function", name: "run", visibility: "public", generics: emptyRustGenerics, params: [],
    body: { statements: [{ kind: "tail", expr: { ...shadow, pattern: { ...pattern, path: "domain::Selected" } } }] } };
  assert.equal(rustItemsReferenceModuleAlias([item], "domain"), true);
  assert.equal(printRustExpr({ ...shadow, pattern: { ...pattern, path: "domain::Selected" }, whenFalse: unit }),
    "if let domain::Selected(value) = source { value } else {  }");
});

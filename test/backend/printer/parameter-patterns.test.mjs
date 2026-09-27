import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { rustPatternBindings } from "../../../dist/backend/target-ast/patterns.js";
import { tupleRustClosureArguments } from "../../../dist/backend/target-ast/expressions.js";
import { rustExpressionReferencesPath } from "../../../dist/backend/target-ast/inspection/source-usage.js";
import { maxWritesInStatements } from "../../../dist/backend/target-ast/inspection/source-dataflow.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { collapseRustForwardingClosure } from "../../../dist/backend/target-ast/normalization/forwarding-closures.js";
import { rustFunctionSurface } from "../../../dist/backend/planner/artifacts/contracts.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";

const integer = { kind: "primitive", name: "u32" };
const path = name => ({ kind: "path", path: name });
const binding = (name, mutable = false) => ({ kind: "binding", name, mutable });
const macro = { kind: "macro-invocation", path: "patterns::selected", input: { delimiter: "brackets", tokens: [] } };
const fn = (params, body = { statements: [] }) => ({ kind: "function", name: "selected", visibility: "public",
  generics: emptyRustGenerics, params, body });

test("functions and both closure forms share reference, mutable, tuple and macro patterns", () => {
  for (const [pattern, expected] of [
    [binding("value"), "value"],
    [binding("value", true), "mut value"],
    [{ kind: "reference", mutable: false, pattern: binding("value") }, "&value"],
    [{ kind: "reference", mutable: false, pattern: binding("value", true) }, "&(mut value)"],
    [{ kind: "reference", mutable: true, pattern: binding("value") }, "&mut value"],
    [{ kind: "tuple", elements: [binding("value")] }, "(value,)"],
    [{ kind: "or", alternatives: [path("Left"), path("Right")] }, "(Left | Right)"],
    [macro, "patterns::selected![]"],
  ]) {
    const params = [{ pattern, type: integer }];
    assert.ok(printRustItem(fn(params)).startsWith(`pub fn selected(${expected}: u32)`));
    assert.equal(printRustExpr({ kind: "closure", params, body: path("value") }), `|${expected}: u32| value`);
    assert.equal(printRustExpr({ kind: "closure-block", params, body: { statements: [] }, move: false, async: false }),
      `|${expected}: u32| {}`);
    assert.equal(printRustExpr({ kind: "closure", params: [{ pattern }], body: path("value") }), `|${expected}| value`);
  }
});

test("parameter dependencies include exact pattern macros and optional closure types", () => {
  const type = { kind: "named", path: "types::Value" };
  for (const expression of [
    { kind: "closure", params: [{ pattern: macro, type }], body: path("value") },
    { kind: "closure-block", params: [{ pattern: macro, type }], body: { statements: [] }, move: false, async: false },
  ]) {
    const items = [fn([], { statements: [{ kind: "expr", expr: expression }] })];
    for (const alias of ["patterns", "types"]) assert.equal(rustItemsReferenceModuleAlias(items, alias), true);
    assert.equal(rustItemsReferenceModuleAlias(items, "unrelated"), false);
  }
  assert.equal(rustItemsReferenceModuleAlias([fn([{ pattern: macro, type }])], "patterns"), true);
});

test("pattern binding queries preserve nesting and never guess names introduced by macros", () => {
  const pattern = { kind: "tuple", elements: [binding("first"),
    { kind: "reference", mutable: false, pattern: binding("second", true) }] };
  assert.deepEqual(rustPatternBindings(pattern).map(value => [value.name, value.mutable]), [["first", false], ["second", true]]);
  assert.equal(rustPatternBindings({ kind: "tuple", elements: [binding("first"), macro] }), undefined);
  const closure = { kind: "closure", params: [{ pattern }], body: path("second") };
  assert.equal(rustExpressionReferencesPath(closure, "second"), false);
  assert.equal(rustExpressionReferencesPath({ ...closure, body: path("outer") }, "outer"), true);
  const unknown = { ...closure, params: [{ pattern: macro }] };
  assert.equal(rustExpressionReferencesPath(unknown, "outer"), true);
  assert.equal(maxWritesInStatements([{ kind: "expr", expr: unknown }], "outer"), 2);
});

test("tuple adapters preserve native patterns and types without synthetic local unpacking", () => {
  for (const expression of [
    { kind: "closure", move: true, body: path("first") },
    { kind: "closure-block", move: true, async: true, body: { statements: [{ kind: "tail", expr: path("first") }] } },
  ]) {
    const params = [{ pattern: binding("first"), type: integer },
      { pattern: { kind: "reference", pattern: binding("second"), mutable: false } }];
    const original = { ...expression, params };
    const tupled = tupleRustClosureArguments(original, 2);
    assert.equal(tupled.body, original.body);
    assert.deepEqual(tupled.params, [{ pattern: { kind: "tuple", elements: params.map(parameter => parameter.pattern) },
      type: { kind: "tuple", elements: [integer, { kind: "infer" }] } }]);
    assert.equal(tupled.move, true);
    assert.equal(tupled.kind, original.kind);
    assert.equal(tupled.async, original.async);
    assert.equal(tupleRustClosureArguments(original, 1), undefined);
  }
  const empty = tupleRustClosureArguments({ kind: "closure", params: [], body: path("value") }, 0);
  assert.equal(printRustExpr(empty), "|()| value");
});

test("forwarding cannot erase explicit parameter types or native destructuring", () => {
  const body = { kind: "call", path: "retain", args: [path("value")] };
  for (const parameter of [
    { pattern: binding("value"), type: integer },
    { pattern: { kind: "reference", mutable: false, pattern: binding("value") } },
    { pattern: { kind: "tuple", elements: [binding("value")] } },
    { pattern: macro },
  ]) {
    const closure = { kind: "closure", params: [parameter], body };
    assert.equal(collapseRustForwardingClosure(closure), closure);
  }
});

test("pattern binding names retain native style allowances and exact public contract identity", () => {
  const pattern = { kind: "tuple", elements: [binding("firstValue"), binding("second_value")] };
  const item = fn([{ pattern, type: { kind: "tuple", elements: [integer, integer] } }],
    { statements: [{ kind: "expr", expr: path("firstValue") }, { kind: "expr", expr: path("second_value") }] });
  const normalized = finalizeRustSourceStyle({ headerComment: "Proof", items: [item] });
  assert.deepEqual(normalized.items[0].params, item.params);
  assert.ok(normalized.items[0].attrs.some(attribute => JSON.stringify(attribute).includes("non_snake_case")));
  const contract = parameters => rustFunctionSurface({ name: "value", isAsync: false, generics: emptyRustGenerics, parameters });
  assert.notEqual(contract([{ pattern: macro, type: integer }]), contract([{ pattern: { ...macro, path: "patterns::other" }, type: integer }]));
  assert.notEqual(contract([{ pattern: binding("value"), type: integer }]), contract([{ pattern: binding("value", true), type: integer }]));
});

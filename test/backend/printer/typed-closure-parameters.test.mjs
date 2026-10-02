import assert from "node:assert/strict";
import test from "node:test";
import { printRustClosureParams } from "../../../dist/print/source/expressions/closure-params.js";
import { collapseRustForwardingClosure } from "../../../dist/backend/target-ast/normalization/forwarding-closures.js";
import { tupleRustClosureArguments } from "../../../dist/backend/target-ast/expressions.js";

test("native typed closure parameters preserve types, reference patterns and mutability", () => {
  assert.equal(printRustClosureParams([
    { name: "arguments", type: { kind: "tuple", elements: [{ kind: "primitive", name: "f64" }] } },
    { name: "value", mutable: true, byRefCopy: true, type: { kind: "reference", mutable: false,
      referent: { kind: "primitive", name: "i32" } } },
  ]), "arguments: (f64,), &(mut value): &i32");
});

test("typed forwarding closures retain their native type constraint", () => {
  const typed = { kind: "closure", params: [{ name: "value", type: { kind: "primitive", name: "i32" } }],
    body: { kind: "call", path: "identity", args: [{ kind: "path", path: "value" }] } };
  assert.equal(collapseRustForwardingClosure(typed), typed);
});

test("tuple closure adaptation retains typed binding and reference-pattern projections", () => {
  const integer = { kind: "primitive", name: "i32" };
  const expression = { kind: "closure", params: [{ name: "value", byRefCopy: true,
    type: { kind: "reference", referent: integer, mutable: false } }], body: { kind: "path", path: "value" } };
  const selected = tupleRustClosureArguments(expression, "arguments", 1);
  assert.deepEqual(selected.body.statements[0].type, integer);
  assert.equal(selected.body.statements[0].init.kind, "dereference");
  assert.equal(selected.body.statements[0].mutable, false);
  assert.equal(tupleRustClosureArguments({ ...expression, params: [{ ...expression.params[0], type: integer }] }, "arguments", 1), undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import { printRustClosureParams } from "../../dist/print/source/expressions/closure-params.js";
import { printRustExpr } from "../../dist/print/source/expressions/core.js";

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
  assert.equal(printRustExpr(typed), "|value: i32| identity(value)");
});

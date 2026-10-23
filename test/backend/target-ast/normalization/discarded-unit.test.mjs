import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";

const unit = { kind: "tuple-literal", elements: [] };
const path = name => ({ kind: "path", path: name });
const finalize = statements => finalizeRustSourceStyle({ items: [{
  kind: "function", name: "run", visibility: "public", generics: emptyRustGenerics, params: [],
  body: { statements },
}] });

test("discarded exact unit expressions disappear without erasing effects, bindings, attributes or completion", () => {
  const call = { kind: "expr", expr: { kind: "call", path: "effect", args: [] } };
  const attributed = { kind: "let", name: "_", mutable: false, init: unit,
    attrs: [{ kind: "list", path: "cfg", arguments: [{ kind: "word", path: "test" }] }] };
  const retained = [
    call,
    { kind: "let", name: "value", mutable: false, init: unit, attrs: undefined },
    { kind: "expr", expr: { kind: "tuple-literal", elements: [path("value")] } },
    attributed,
    { kind: "return", expr: unit },
    { kind: "tail", expr: unit },
  ];
  const selected = finalize([
    { kind: "expr", expr: unit },
    { kind: "let", name: "_", mutable: false, init: unit },
    ...retained,
  ]);
  assert.equal(selected.items[0].body.statements.length, retained.length);
  assert.equal(JSON.stringify(selected.items[0].body.statements) === JSON.stringify(retained), true,
    "retain all observable statements and their exact native AST");
  assert.equal(JSON.stringify(finalizeRustSourceStyle(selected)) === JSON.stringify(selected), true,
    "normalization is idempotent");
});

test("return bindings retain their native statement temporary and local drop boundaries", () => {
  const owner = { kind: "let", name: "owner", mutable: false, init: { kind: "call", path: "make_owner", args: [] } };
  const borrowed = { kind: "method-call", receiver: { kind: "field", receiver: path("owner"), name: "value" },
    method: "borrow", args: [] };
  for (const [label, value] of [
    ["borrow guard dereference", { kind: "dereference", pointer: borrowed }],
    ["opaque native call", { kind: "call", path: "observe", args: [path("owner")] }],
    ["native method call", borrowed],
    ["native field", { kind: "field", receiver: path("owner"), name: "value" }],
    ["untyped path", path("owner")],
  ]) {
    const statements = [owner, { kind: "let", name: "returned", mutable: false, init: value },
      { kind: "tail", expr: path("returned") }];
    const normalized = finalize(statements);
    const actual = normalized.items[0].body.statements;
    assert.equal(actual.length, 3, `${label}: no unproved temporary-scope change`);
    assert.equal(actual[0].name, "owner", `${label}: the receiver is evaluated once before its read`);
    assert.equal(actual[1].kind, "let", `${label}: the read completes at its original semicolon`);
    assert.equal(actual[1].name, "returned", `${label}: the result is bound before its owner's drop`);
    assert.equal(actual[2].expr.kind, "path", `${label}: the tail is the already evaluated result`);
    assert.equal(actual[2].expr.path, "returned", `${label}: no call, borrow or field is evaluated again at the tail`);
    assert.equal(JSON.stringify(actual) === JSON.stringify(statements), true, `${label}: retain the complete native drop order`);
    assert.equal(JSON.stringify(finalizeRustSourceStyle(normalized)) === JSON.stringify(normalized), true,
      `${label}: preserving scope boundaries is idempotent`);
  }
});

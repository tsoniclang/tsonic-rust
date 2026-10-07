import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustSourceStyle } from "../../../../dist/backend/target-ast/normalization/source-style.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/nodes.js";

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

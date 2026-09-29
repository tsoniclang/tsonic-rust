import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/nodes.js";
import { completeRustAuthoredStructScopes } from "../../../../dist/backend/planner/declarations/scoped-types.js";

test("hoisted authored type scopes import only selected enclosing bindings", () => {
  const declaration = { kind: "struct", name: "Entry", visibility: "crate", generics: {
    parameters: [{ kind: "type", name: "Payload", bounds: [] }], wherePredicates: [],
  }, fields: [
    { name: "value", visibility: "parent", type: { kind: "named", path: "Payload" } },
    { name: "handle", visibility: "private", type: { kind: "named", path: "rt::Handle" } },
    { name: "bytes", visibility: "private", type: { kind: "fixed-array", element: { kind: "primitive", name: "u8" },
      length: { kind: "path", path: "COUNT" } } },
  ] };
  const scope = { kind: "mod-decl", name: "entry_scope", visibility: "crate", body: { items: [declaration] } };
  const items = [
    { kind: "use", path: "native_runtime", alias: "rt" },
    { kind: "struct", name: "Payload", visibility: "crate", generics: emptyRustGenerics, fields: [] },
    { kind: "const", name: "COUNT", visibility: "crate", type: { kind: "primitive", name: "usize" }, value: { kind: "int-literal", text: "4" } },
    { kind: "use", path: "unused_runtime", alias: "unused" }, scope,
  ];
  const completed = completeRustAuthoredStructScopes(items, new Set(["entry_scope"]));
  assert.deepEqual(completed.at(-1).body.items, [
    { kind: "use", path: "super::rt" }, { kind: "use", path: "super::COUNT" }, declaration,
  ]);
  assert.deepEqual(scope.body.items, [declaration]);
  assert.equal(completeRustAuthoredStructScopes(items, new Set()), items);
});

test("primitive-only local classes need no enclosing scope imports", () => {
  const declaration = { kind: "struct", name: "Entry", visibility: "crate", generics: emptyRustGenerics,
    fields: [{ name: "value", visibility: "parent", type: { kind: "primitive", name: "i32" } }] };
  const items = [{ kind: "mod-decl", name: "entry_scope", visibility: "crate", body: { items: [declaration] } }];
  assert.deepEqual(completeRustAuthoredStructScopes(items, new Set(["entry_scope"])), items);
});

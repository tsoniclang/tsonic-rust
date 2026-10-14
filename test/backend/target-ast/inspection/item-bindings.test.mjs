import assert from "node:assert/strict";
import test from "node:test";
import { rustItemBindingNames } from "../../../../dist/backend/target-ast/inspection/item-bindings.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";

test("native item bindings include named declarations, direct imports and explicit import aliases", () => {
  const items = [
    { kind: "struct", name: "InitializationError", visibility: "public", generics: emptyRustGenerics, fields: [] },
    { kind: "use", path: "crate::module::InitializationErrors", visibility: "public" },
    { kind: "use", path: "external::Payload", alias: "InitializationError_2" },
    { kind: "mod-decl", name: "Module", visibility: "crate" },
    { kind: "extern-crate", name: "External" },
    { kind: "impl", target: { kind: "named", path: "Type" }, generics: emptyRustGenerics, members: [] },
  ];
  assert.deepEqual(items.flatMap(rustItemBindingNames), [
    "InitializationError", "InitializationErrors", "InitializationError_2", "Module", "External",
  ]);
  assert.equal(items[2].alias, "InitializationError_2", "authored/imported spellings are not rewritten");
});

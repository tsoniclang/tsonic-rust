import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics, createRustSourceFile } from "../../../dist/backend/target-ast/syntax/nodes.js";
import { printRustItem } from "../../../dist/print/source/declarations.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/syntax/module-references.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";

const family = {
  kind: "trait", name: "Storage", visibility: "public", generics: emptyRustGenerics,
  members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, bounds: [{ kind: "trait", path: "Clone" }] }],
};
const implementation = {
  kind: "impl", generics: emptyRustGenerics, trait: { kind: "named", path: "Storage" },
  target: { kind: "primitive", name: "i32" },
  members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, type: { kind: "primitive", name: "i32" } }],
};

test("associated storage outputs stay typed until the final Rust printer", () => {
  assert.equal(printRustItem(family), "pub trait Storage {\n    type Output: Clone;\n}");
  assert.equal(printRustItem(implementation), "impl Storage for i32 {\n    type Output = i32;\n}");
  assert.throws(() => printRustItem({ ...implementation, trait: undefined }),
    /Associated type definitions require an exact trait implementation/u);
});

test("associated bounds and definitions retain their module dependencies", () => {
  const bound = { ...family, members: [{ kind: "type", name: "Output", generics: emptyRustGenerics, bounds: [
    { kind: "trait-type", reference: { trait: { kind: "named", path: "storage::Value" } } },
  ] }] };
  const output = { ...implementation, members: [{ kind: "type", name: "Output", generics: emptyRustGenerics,
    type: { kind: "named", path: "data::Payload" } }] };
  assert.equal(rustItemsReferenceModuleAlias([bound], "storage"), true);
  assert.equal(rustItemsReferenceModuleAlias([output], "data"), true);
  assert.equal(rustItemsReferenceModuleAlias([bound, output], "unrelated"), false);
});

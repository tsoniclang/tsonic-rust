import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics, createRustSourceFile } from "../../../dist/backend/target-ast/nodes.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { rustSourceFileContractCandidate } from "../../../dist/backend/planner/artifacts/source-file-contract.js";

const family = {
  kind: "trait", name: "Storage", visibility: "public", generics: emptyRustGenerics,
  associatedTypes: [{ name: "Output", bounds: [{ kind: "trait", path: "Clone" }] }],
  functions: [],
};
const implementation = {
  kind: "impl", generics: emptyRustGenerics, trait: { kind: "named", path: "Storage" },
  target: { kind: "primitive", name: "i32" },
  associatedTypes: [{ name: "Output", type: { kind: "primitive", name: "i32" } }],
  functions: [],
};

test("associated storage outputs stay typed until the final Rust printer", () => {
  assert.equal(printRustItem(family), "pub trait Storage {\n    type Output: Clone;\n}");
  assert.equal(printRustItem(implementation), "impl Storage for i32 {\n    type Output = i32;\n}");
  assert.throws(() => printRustItem({ ...implementation, trait: undefined }),
    /Associated type definitions require an exact trait implementation/u);
});

test("associated bounds and definitions retain their module dependencies", () => {
  const bound = { ...family, associatedTypes: [{ name: "Output", bounds: [
    { kind: "trait-type", reference: { trait: { kind: "named", path: "storage::Value" } } },
  ] }] };
  const output = { ...implementation, associatedTypes: [{ name: "Output",
    type: { kind: "named", path: "data::Payload" } }] };
  assert.equal(rustItemsReferenceModuleAlias([bound], "storage"), true);
  assert.equal(rustItemsReferenceModuleAlias([output], "data"), true);
  assert.equal(rustItemsReferenceModuleAlias([bound, output], "unrelated"), false);
});

test("public storage output changes invalidate the artifact public contract", () => {
  const surface = (item) => rustSourceFileContractCandidate("family", createRustSourceFile([item]), [])
    .contract.facets.find((facet) => facet.facet === "source-file-public-surface").value;
  assert.notEqual(surface(implementation), surface({ ...implementation, associatedTypes: [
    { name: "Output", type: { kind: "primitive", name: "u32" } },
  ] }));
  assert.notEqual(surface(family), surface({ ...family, associatedTypes: [
    { name: "Output", bounds: [] },
  ] }));
});

test("public associated output types cannot remain private", () => {
  const model = finalizeRustSourceStyle(createRustSourceFile([
    family,
    { kind: "struct", name: "Payload", visibility: "private", generics: emptyRustGenerics,
      derives: [], fields: [] },
    { ...implementation, associatedTypes: [{ name: "Output", type: { kind: "named", path: "Payload" } }] },
  ]));
  assert.equal(model.items.find((item) => item.kind === "struct").visibility, "public");
});

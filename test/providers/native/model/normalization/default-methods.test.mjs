import assert from "node:assert/strict";
import test from "node:test";
import { selectedRustDefaultMethods } from "../../../../../dist/providers/native/model/normalization/default-methods.js";
import { emptyRustCompilerSubstitutions, rustCompilerItemIdentity } from "../../../../../dist/providers/native/model/rustdoc-types.js";

const dependency = { alias: "example", packageId: "example 1", packageName: "example", packageVersion: "1",
  crateName: "example", targetCrateName: "example", manifestPath: "/example/Cargo.toml",
  sourceRoot: "/example", sourceDigest: "test", closurePackageIds: ["example 1"], features: [] };

function fixture() {
  const trait = { id: 1, name: "Sequence", visibility: "public", inner: { trait: {
    generics: { params: [], where_predicates: [] }, items: [2, 3],
  } } };
  const document = { index: { 1: trait,
    2: { id: 2, name: "next", inner: { function: { has_body: false } } },
    3: { id: 3, name: "count", inner: { function: { has_body: true } } },
    4: { id: 4, name: "count", inner: { function: { has_body: true } } },
  }, paths: { 1: { path: ["example", "Sequence"], kind: "trait" } } };
  const implementation = { trait: { id: 1 }, provided_trait_methods: ["count"], items: [] };
  const dispatch = { identity: rustCompilerItemIdentity(document, dependency, trait),
    genericArguments: [], associatedConstraints: [] };
  return { document, implementation, dispatch };
}

test("default methods select exact trait declarations and retain explicit overrides", () => {
  const { document, implementation, dispatch } = fixture();
  const select = value => selectedRustDefaultMethods(document, dependency, value, dispatch, emptyRustCompilerSubstitutions);
  const { methods, unsupported } = select(implementation);
  assert.deepEqual(unsupported, []);
  assert.equal(methods.length, 1);
  assert.equal(methods[0].item, document.index[3]);
  assert.equal(methods[0].document, document);
  assert.deepEqual(select({ ...implementation, items: [4] }).methods, []);
  assert.deepEqual(select({ ...implementation, provided_trait_methods: [] }).methods, []);
  for (const names of [["count", "count"], [3]]) {
    assert.throws(() => select({ ...implementation, provided_trait_methods: names }));
  }
  for (const name of ["missing", "next"]) {
    const selected = select({ ...implementation, provided_trait_methods: ["count", name] });
    assert.equal(selected.methods.length, 1);
    assert.deepEqual(selected.unsupported.map(member => member.name), [name]);
    assert.match(selected.unsupported[0].reason, /no exact default implementation/u);
  }
  document.index[5] = { ...document.index[3], id: 5 };
  document.index[1].inner.trait.items.push(5);
  assert.equal(select(implementation).methods.length, 0);
  assert.match(select(implementation).unsupported[0].reason, /no exact default implementation/u);
});

test("external generic trait defaults bind checked trait arguments without owner-name inference", () => {
  const { document, implementation, dispatch } = fixture();
  document.index[1].inner.trait.generics.params = [{ name: "Element", kind: {
    type: { bounds: [], default: null, is_synthetic: false },
  } }];
  const caller = { index: {}, paths: {} };
  const scalar = { kind: "primitive", name: "u64" };
  const { methods, unsupported } = selectedRustDefaultMethods(caller, dependency, implementation,
    { ...dispatch, genericArguments: [{ kind: "type", type: scalar }] }, emptyRustCompilerSubstitutions,
    (selectedDocument, selectedDependency, identity) => {
      assert.equal(selectedDocument, caller);
      assert.equal(selectedDependency, dependency);
      assert.equal(identity, 1);
      return { document, dependency, item: document.index[1] };
    });
  assert.deepEqual(unsupported, []);
  assert.equal(methods[0].document, document);
  const parameter = methods[0].inheritedGenericParameters[0];
  assert.equal(parameter.name, "Element");
  assert.deepEqual(methods[0].implementationBindings.types.get(parameter.identity.itemId), scalar);
  assert.throws(() => selectedRustDefaultMethods(document, dependency, implementation,
    dispatch, emptyRustCompilerSubstitutions), /no exact argument/u);
});

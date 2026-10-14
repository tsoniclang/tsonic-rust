import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";

const families = [
  ["typeAliasDeclaration", "typeAliasDeclarations"],
  ["mutatedBinding", "mutatedBindings"],
  ["mutatedReferent", "mutatedReferents"],
];
const text = { kind: "target-named", id: "rust.std.String" };

function stringLiteralWalk(builder, variants) {
  return {
    sourceTypes: { enumVariantsForDeclaration: () => variants, carrierForDeclaration: () => text },
    context: { projectTypes: { definitionForDeclaration: () => undefined }, ast: {}, records: builder, diagnostics: [] },
  };
}

test("type-alias and mutation families expose one immutable reader and no general writer", () => {
  const builder = createRustProgramRecordBuilder();
  const sealed = builder.seal();
  for (const [family, producer] of families) {
    assert.equal(builder[producer].records === builder[family], true, family);
    assert.equal(builder[family] === sealed[family], true, family);
    assert.equal(Object.isFrozen(sealed[family]), true, family);
    assert.deepEqual(Object.keys(sealed[family]), ["get"], family);
    assert.equal(sealed[family].get(undefined) === undefined, true, family);
    assert.equal(sealed[family].get({}) === undefined, true, family);
    assert.equal(builder[family].set === undefined, true, family);
    assert.equal(sealed[producer] === undefined, true, family);
    assert.equal(Object.isFrozen(builder[producer]), true, family);
  }
  const subject = {};
  for (const attempt of [
    () => builder.typeAliasDeclarations.register({}, subject),
    () => builder.mutatedBindings.written(subject),
    () => builder.mutatedReferents.written(subject),
  ]) assert.throws(attempt, /after analysis is sealed/u);
});

test("binding and referent writes publish one frozen fact for the exact declaration only", () => {
  const builder = createRustProgramRecordBuilder();
  const binding = {};
  const referent = {};
  builder.mutatedBindings.written(binding);
  builder.mutatedReferents.written(referent);
  assert.deepEqual(builder.mutatedBinding.get(binding), { mutated: true });
  assert.equal(Object.isFrozen(builder.mutatedBinding.get(binding)), true);
  assert.deepEqual(builder.mutatedReferent.get(referent), { mutated: true });
  assert.equal(builder.mutatedReferent.get(binding) === undefined, true, "a binding write does not mark its referent");
  assert.equal(builder.mutatedBinding.get(referent) === undefined, true, "a referent write does not mark the binding");
  assert.equal(builder.mutatedBinding.get({}) === undefined, true, "foreign declaration identity");
  assert.equal(builder.minimumFoundation(), "core", "mutation facts add no native foundation requirement");
});

test("repeated writes of the same declaration keep the first fact without rejecting the repeat", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  builder.mutatedBindings.written(declaration);
  const first = builder.mutatedBinding.get(declaration);
  assert.doesNotThrow(() => builder.mutatedBindings.written(declaration));
  assert.doesNotThrow(() => builder.mutatedReferents.written(declaration));
  assert.doesNotThrow(() => builder.mutatedReferents.written(declaration));
  assert.equal(builder.mutatedBinding.get(declaration) === first, true);
});

test("scoped builders read inherited mutation facts and never publish new ones into the parent", () => {
  const parent = createRustProgramRecordBuilder();
  const inherited = {};
  parent.mutatedBindings.written(inherited);
  parent.mutatedReferents.written(inherited);
  const sealed = parent.seal();
  const child = createRustProgramRecordBuilder(undefined, sealed);
  assert.equal(child.mutatedBinding.get(inherited) === sealed.mutatedBinding.get(inherited), true);
  assert.equal(child.mutatedReferent.get(inherited) === sealed.mutatedReferent.get(inherited), true);
  child.mutatedBindings.written(inherited);
  assert.equal(child.mutatedBinding.get(inherited) === sealed.mutatedBinding.get(inherited), true);
  const fresh = {};
  child.mutatedBindings.written(fresh);
  child.mutatedReferents.written(fresh);
  assert.equal(sealed.mutatedBinding.get(fresh) === undefined, true);
  assert.equal(sealed.mutatedReferent.get(fresh) === undefined, true);
});

test("type-alias registration publishes the selected declaration fact and keeps its carrier side effect", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const variants = [{ name: "On", literal: "on" }, { name: "Off", literal: "off" }];
  builder.typeAliasDeclarations.register(stringLiteralWalk(builder, variants), declaration);
  const fact = builder.typeAliasDeclaration.get(declaration);
  assert.equal(fact.kind, "string-literal");
  assert.equal(fact.variants === variants, true, "the selected variant list is published unchanged");
  assert.equal(builder.runtimeCarrier.get(declaration)?.carrier === text, true, "the declaration carrier is recorded first");
  assert.doesNotThrow(() => builder.typeAliasDeclarations.register(stringLiteralWalk(builder, [...variants]), declaration));
  assert.equal(builder.typeAliasDeclaration.get(declaration) === fact, true, "an equal repeat keeps the first fact");
});

test("type-alias registration publishes nothing when the selector finds no declaration form", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const walk = {
    sourceTypes: { enumVariantsForDeclaration: () => undefined },
    context: {
      records: builder,
      ast: { typeParameters: () => [], name: () => undefined, text: () => "", getSourceFile: () => ({}), getFileName: () => "" },
      sourceLifetimes: { contractFor: () => undefined },
      semanticsFor: () => ({ declarations: { declaredType: () => undefined } }),
    },
  };
  builder.typeAliasDeclarations.register(walk, declaration);
  assert.equal(builder.typeAliasDeclaration.get(declaration) === undefined, true);
});

test("inherited type-alias facts reject a different selection without publishing over the parent", () => {
  const parent = createRustProgramRecordBuilder();
  const declaration = {};
  const variants = [{ name: "On", literal: "on" }];
  parent.typeAliasDeclarations.register(stringLiteralWalk(parent, variants), declaration);
  const sealed = parent.seal();
  const original = sealed.typeAliasDeclaration.get(declaration);
  const child = createRustProgramRecordBuilder(undefined, sealed);
  child.typeAliasDeclarations.register(stringLiteralWalk(child, [{ name: "On", literal: "on" }]), declaration);
  assert.equal(child.typeAliasDeclaration.get(declaration) === original, true, "an equal inherited selection is reused");
  assert.throws(() => child.typeAliasDeclarations.register(stringLiteralWalk(child, [{ name: "On", literal: "yes" }]), declaration),
    /Conflicting Rust semantic plan 'tsonic\.rust\.typeAliasDeclaration'/u);
  assert.equal(child.typeAliasDeclaration.get(declaration) === original, true);
  const fresh = {};
  child.typeAliasDeclarations.register(stringLiteralWalk(child, variants), fresh);
  assert.equal(sealed.typeAliasDeclaration.get(fresh) === undefined, true);
});

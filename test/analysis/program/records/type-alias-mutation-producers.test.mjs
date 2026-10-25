import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";

const families = [
  ["typeAliasDeclaration", "typeAliasDeclarations"],
  ["mutatedBinding", "mutatedBindings"],
  ["mutatedReferent", "mutatedReferents"],
];
const text = { kind: "target-named", id: "rust.std.String" };

function referentWrite(target) {
  return { target, receivers: [{ expression: target, use: target }] };
}

function stringLiteralWalk(builder, variants) {
  return {
    sourceTypes: { enumVariantsForDeclaration: () => variants, carrierForDeclaration: () => text },
    context: { requiredRecords: [], projectTypes: { definitionForDeclaration: () => undefined }, ast: {}, records: builder, diagnostics: [] },
  };
}

test("type-alias and mutation families expose one immutable reader and no general writer", () => {
  const builder = createRustProgramRecordBuilder();
  const sealed = builder.seal([]);
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
    () => builder.mutatedReferents.written(subject, referentWrite(subject)),
  ]) assert.throws(attempt, /after analysis is sealed/u);
});

test("binding and referent writes publish one frozen fact for the exact declaration only", () => {
  const builder = createRustProgramRecordBuilder();
  const binding = {};
  const referent = {};
  builder.mutatedBindings.written(binding);
  builder.mutatedReferents.written(referent, referentWrite(referent));
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
  assert.doesNotThrow(() => builder.mutatedReferents.written(declaration, referentWrite(declaration)));
  assert.doesNotThrow(() => builder.mutatedReferents.written(declaration, referentWrite(declaration)));
  assert.equal(builder.mutatedBinding.get(declaration) === first, true);
});

test("scoped builders read inherited mutation facts and never publish new ones into the parent", () => {
  const parent = createRustProgramRecordBuilder();
  const inherited = {};
  parent.mutatedBindings.written(inherited);
  parent.mutatedReferents.written(inherited, referentWrite(inherited));
  const sealed = parent.seal([]);
  const child = createRustProgramRecordBuilder(undefined, sealed);
  assert.equal(child.mutatedBinding.get(inherited) === sealed.mutatedBinding.get(inherited), true);
  assert.equal(child.mutatedReferent.get(inherited) === sealed.mutatedReferent.get(inherited), true);
  child.mutatedBindings.written(inherited);
  assert.equal(child.mutatedBinding.get(inherited) === sealed.mutatedBinding.get(inherited), true);
  const fresh = {};
  child.mutatedBindings.written(fresh);
  child.mutatedReferents.written(fresh, referentWrite(fresh));
  assert.equal(sealed.mutatedBinding.get(fresh) === undefined, true);
  assert.equal(sealed.mutatedReferent.get(fresh) === undefined, true);
});

test("positive mutation events retain canonical local and inherited facts and still refuse cached writes after seal", () => {
  const parent = createRustProgramRecordBuilder();
  const declaration = {};
  parent.mutatedBindings.written(declaration);
  parent.mutatedReferents.written(declaration, referentWrite(declaration));
  const binding = parent.mutatedBinding.get(declaration);
  const referent = parent.mutatedReferent.get(declaration);
  const child = createRustProgramRecordBuilder(undefined, parent);
  for (let repeat = 0; repeat < 4; repeat += 1) {
    child.mutatedBindings.written(declaration);
    child.mutatedReferents.written(declaration, referentWrite(declaration));
    assert.equal(child.mutatedBinding.get(declaration) === binding, true);
    assert.equal(child.mutatedReferent.get(declaration) === referent, true);
  }
  const fresh = {};
  child.mutatedBindings.written(fresh);
  const selected = child.mutatedBinding.get(fresh);
  child.mutatedBindings.written(fresh);
  assert.equal(child.mutatedBinding.get(fresh) === selected, true);
  assert.equal(child.mutatedReferent.get(fresh) === undefined, true, "the two write-evidence families remain independent");
  assert.equal(parent.mutatedBinding.get(fresh) === undefined, true, "child events never mutate a live parent");
  child.seal([]);
  for (const subject of [declaration, fresh]) {
    assert.throws(() => child.mutatedBindings.written(subject), /after analysis is sealed/u);
    assert.throws(() => child.mutatedReferents.written(subject, referentWrite(subject)), /after analysis is sealed/u);
  }
});

test("referent finalization retains each original write and its immutable native receiver path once", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const first = {};
  const second = {};
  const receiver = {};
  const path = [{ expression: receiver, use: first }];
  builder.mutatedReferents.written(declaration, { target: first, receivers: path });
  builder.mutatedReferents.written(declaration, { target: first, receivers: [...path] });
  builder.mutatedReferents.written(declaration, referentWrite(second));
  let decisions = 0;
  builder.mutatedReferents.finalizeBindings((selected, writes) => {
    decisions++;
    assert.equal(selected === declaration, true, "the decision belongs to the original checked declaration");
    assert.equal(writes.length, 2, "equal repeats preserve both distinct source writes without duplicating either");
    assert.equal(writes[0].target === first && writes[1].target === second, true,
      "receiver normalization never substitutes the original actual write target");
    assert.equal(writes[0].receivers[0].expression === receiver && writes[0].receivers[0].use === first, true,
      "the native receiver stays paired with its exact admitted use");
    assert.equal(Object.isFrozen(writes) && Object.isFrozen(writes[0]) && Object.isFrozen(writes[0].receivers) &&
      Object.isFrozen(writes[0].receivers[0]), true, "only owned write data is frozen at its producer");
    assert.equal(Object.isFrozen(first), false, "source nodes are not recursively frozen");
    assert.throws(() => { writes[0].receivers[0].expression = second; }, TypeError,
      "a consumer cannot replace the actual source receiver");
    return true;
  });
  assert.equal(decisions, 1, "there is one final native mutability decision for the declaration");
  assert.equal(builder.mutatedReferentBinding.get(declaration)?.mutableBinding, true,
    "the canonical final fact is the only consumer-visible mutability decision");
  assert.throws(() => builder.mutatedReferents.written(declaration, referentWrite(second)), /must precede/u,
    "later source writes cannot silently bypass completed native classification");
  assert.throws(() => builder.mutatedReferents.finalizeBindings(() => true), /finalized once/u,
    "a second finalization cannot recompute the decision");
});

test("referent writes require their actual complete receiver path", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const target = {};
  assert.throws(() => builder.mutatedReferents.written(declaration, { target, receivers: [] }), /actual receiver path/u);
  assert.equal(builder.mutatedReferent.get(declaration) === undefined, true,
    "an incomplete source write publishes no mutation fact");
  builder.mutatedReferents.written(declaration, referentWrite(target));
  assert.throws(() => builder.mutatedReferents.written(declaration,
    { target, receivers: [{ expression: declaration, use: target }] }), /one exact source receiver path/u,
  "a repeated target cannot silently replace its original receiver identity");
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
  let selections = 0;
  const walk = {
    sourceTypes: { enumVariantsForDeclaration() { selections++; return undefined; } },
    context: { requiredRecords: [],
      records: builder,
      ast: { typeParameters: () => [], name: () => undefined, text: () => "", getSourceFile: () => ({}), getFileName: () => "" },
      sourceLifetimes: { contractFor: () => undefined },
      semanticsFor: () => ({ declarations: { declaredType: () => undefined } }),
    },
  };
  builder.typeAliasDeclarations.register(walk, declaration);
  assert.equal(builder.typeAliasDeclaration.get(declaration) === undefined, true);
  builder.typeAliasDeclarations.register(walk, declaration);
  assert.equal(builder.typeAliasDeclaration.get(declaration) === undefined, true);
  assert.equal(selections, 2, "an unavailable declaration query does not become completed state");
});

test("inherited type-alias facts reject a different selection without publishing over the parent", () => {
  const parent = createRustProgramRecordBuilder();
  const declaration = {};
  const variants = [{ name: "On", literal: "on" }];
  const parentWalk = stringLiteralWalk(parent, variants);
  parent.typeAliasDeclarations.register(parentWalk, declaration);
  const sealed = parent.seal(parentWalk.context.requiredRecords);
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

test("successful type-alias queries select once per actual walk and still validate a different requester", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const variants = [{ name: "On", literal: "on" }];
  const walk = stringLiteralWalk(builder, variants);
  let selections = 0;
  walk.sourceTypes.enumVariantsForDeclaration = () => { selections++; return variants; };
  builder.typeAliasDeclarations.register(walk, declaration);
  const canonical = builder.typeAliasDeclaration.get(declaration);
  builder.typeAliasDeclarations.register(walk, declaration);
  assert.equal(selections, 1);
  assert.equal(builder.typeAliasDeclaration.get(declaration) === canonical, true);
  const requester = { ...walk };
  builder.typeAliasDeclarations.register(requester, declaration);
  builder.typeAliasDeclarations.register(requester, declaration);
  assert.equal(selections, 2, "a distinct requesting walk validates once without re-admission");
  assert.equal(builder.typeAliasDeclaration.get(declaration) === canonical, true);
  builder.seal(walk.context.requiredRecords);
  assert.throws(() => builder.typeAliasDeclarations.register(requester, declaration), /after analysis is sealed/u);
  assert.equal(selections, 2, "closed analysis rejects before cached work");
});

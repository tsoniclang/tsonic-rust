import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { recordRustValueCarrierReconciliation } from "../../../../dist/analysis/program/records/types/value-carrier-admission.js";
import { rustValueCarrierBeforeContextualConversion } from "../../../../dist/analysis/conversions/value-carrier-queries.js";
import { selectRustCallScopedLifetimeReconciliation } from "../../../../dist/policy/conversions/value-carrier-reconciliation.js";
import { rustOptionTargetType, rustSourceTypeCarrier, rustStringTargetType } from "../../../../dist/target-model/types/index.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const source = rustSourceTypeCarrier("/source.ts", "Derived", "object", []);
const target = rustSourceTypeCarrier("/source.ts", "Base", "object", []);
const reference = lifetime => ({ kind: "reference", mutable: false, referent: integer,
  ...(lifetime === undefined ? {} : { lifetime }),
});
const lifetime = (callIdentity = "call:1", parameterIdentity = "parameter:1") =>
  ({ kind: "call-scoped-elision", callIdentity, parameterIdentity });
const families = [
  ["callScopedLifetimeReconciliation", "callScopedLifetimes", owner => owner.reconcile({}, source, target)],
  ["projectUpcast", "projectUpcasts", owner => owner.project({}, source, target)],
  ["projectDowncast", "projectDowncasts", owner => owner.project({}, target, target, source, { kind: "generic" })],
];

test("lifetime and project families expose only frozen readers and close their real producers at the seal", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const records = builder.seal(builderRequiredRecords);
  for (const [family, producer, attempt] of families) {
    assert.equal(builder[family] === builder[producer].records, true, family);
    assert.equal(records[family] === builder[family], true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(Object.isFrozen(records[family]), true, family);
    assert.equal(Object.isFrozen(builder[producer]), true, producer);
    assert.equal(builder[family].set === undefined, true, family);
    assert.equal(records[producer] === undefined, true, producer);
    assert.equal(records[family].get({}) === undefined, true, family);
    assert.equal(records[family].get(undefined) === undefined, true, family);
    assert.throws(() => attempt(builder[producer]), /after analysis is sealed/u, producer);
  }
});

test("call-scoped lifetime production retains exact carriers, call and parameter identities", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const subject = {};
  const input = reference();
  const selected = reference(lifetime());
  const fact = selectRustCallScopedLifetimeReconciliation(input, selected);
  assert.equal(fact !== undefined, true);
  recordRustValueCarrierReconciliation(builder, builderRequiredRecords, subject, { kind: "call-scoped-lifetime", fact });
  const stored = builder.callScopedLifetimeReconciliation.get(subject);
  assert.equal(stored?.sourceCarrier === input, true);
  assert.equal(stored.selectedCarrier === selected, true);
  assert.equal(stored.selectedCarrier.lifetime === selected.lifetime, true);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(rustValueCarrierBeforeContextualConversion(builder, subject) === selected, true);
  assert.throws(() => builder.callScopedLifetimes.reconcile(subject, reference(), reference(lifetime())), /Duplicate Rust semantic plan/u);
  assertRustInheritedRecordCorrespondence("callScopedLifetimeReconciliation", subject, stored,
    candidate => candidate.callScopedLifetimes.reconcile(subject, reference(), reference(lifetime())));
  assert.equal(builder.callScopedLifetimeReconciliation.get(subject) === stored, true);
  const incompatible = [
    [reference(lifetime("other-call")), selected],
    [input, reference(lifetime("other-call"))],
    [input, reference(lifetime("call:1", "other-parameter"))],
    [input, { ...selected, mutable: true }],
    [input, { ...selected, referent: wide }],
  ];
  for (const [inputCarrier, selectedCarrier] of incompatible) {
    assertRustInheritedRecordConflict("callScopedLifetimeReconciliation", subject, stored,
      candidate => candidate.callScopedLifetimes.reconcile(subject, inputCarrier, selectedCarrier),
      /Conflicting Rust semantic plan 'tsonic\.rust\.callScopedLifetimeReconciliation'/u);
    assert.equal(builder.callScopedLifetimeReconciliation.get(subject) === stored, true);
  }
  for (const inputCarrier of [reference({ kind: "static" }), { ...input, mutable: true }, { ...input, referent: wide }]) {
    assert.equal(selectRustCallScopedLifetimeReconciliation(inputCarrier, selected) === undefined, true);
  }
  assert.equal(builder.projectUpcast.get(subject) === undefined, true);
  assert.equal(builder.contextualValueConversion.get(subject) === undefined, true);
  assert.equal(builder.minimumFoundation(), "core");
});

test("lifetime specializations retain inherited identity and never write into the parent", () => {
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const subject = {};
  const input = reference();
  const selected = reference(lifetime());
  parent.callScopedLifetimes.reconcile(subject, input, selected);
  const fact = parent.callScopedLifetimeReconciliation.get(subject);
  const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
  const childRequiredRecords = [];
  child.callScopedLifetimes.reconcile(subject, reference(), reference(lifetime()));
  assert.equal(child.callScopedLifetimeReconciliation.get(subject) === fact, true);
  const foreign = {};
  child.callScopedLifetimes.reconcile(foreign, selected, input);
  assert.equal(child.callScopedLifetimeReconciliation.get(foreign)?.sourceCarrier === selected, true);
  assert.equal(parent.callScopedLifetimeReconciliation.get(foreign) === undefined, true);
  assertRustInheritedRecordConflict("callScopedLifetimeReconciliation", subject, fact,
    candidate => candidate.callScopedLifetimes.reconcile(subject, input, reference(lifetime("other-call"))),
    /Conflicting Rust semantic plan/u);
  assert.equal(child.seal(childRequiredRecords).callScopedLifetimeReconciliation.get(subject) === fact, true);
  assert.throws(() => child.callScopedLifetimes.reconcile({}, input, selected), /after analysis is sealed/u);
});

test("project upcast production preserves exact ordered source variants and inherited evidence", () => {
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const subject = {};
  const variants = Object.freeze([
    Object.freeze({ name: "Left", carrier: source }),
    Object.freeze({ name: "Right", carrier: integer }),
  ]);
  recordRustValueCarrierReconciliation(parent, parentRequiredRecords, subject, {
    kind: "project-upcast", fact: { sourceCarrier: source, targetCarrier: target, sourceVariants: variants },
  });
  const fact = parent.projectUpcast.get(subject);
  assert.equal(fact?.sourceCarrier === source, true);
  assert.equal(fact.targetCarrier === target, true);
  assert.equal(fact.sourceVariants === variants, true);
  assert.equal(Object.isFrozen(fact), true);
  const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
  const childRequiredRecords = [];
  child.projectUpcasts.project(subject, source, target, variants.map(variant => ({ ...variant })));
  assert.equal(child.projectUpcast.get(subject) === fact, true);
  for (const changed of [undefined, [], [...variants].reverse(),
    [{ ...variants[0], name: "Other" }, variants[1]], [{ ...variants[0], carrier: wide }, variants[1]]]) {
    assertRustInheritedRecordConflict("projectUpcast", subject, fact,
      candidate => candidate.projectUpcasts.project(subject, source, target, changed),
      /Conflicting Rust semantic plan 'tsonic\.rust\.projectUpcast'/u);
    assert.equal(child.projectUpcast.get(subject) === fact, true);
  }
  for (const [inputCarrier, outputCarrier] of [[target, target], [source, source]]) {
    assertRustInheritedRecordConflict("projectUpcast", subject, fact,
      candidate => candidate.projectUpcasts.project(subject, inputCarrier, outputCarrier, variants),
      /Conflicting Rust semantic plan/u);
  }
  const foreign = {};
  child.projectUpcasts.project(foreign, source, target);
  assert.equal(Object.hasOwn(child.projectUpcast.get(foreign), "sourceVariants"), false);
  assert.equal(parent.projectUpcast.get(foreign) === undefined, true);
  assert.equal(child.minimumFoundation(), "core");
});

for (const projection of [{ kind: "closed", slot: "cast" }, { kind: "checked", slot: "cast" },
  { kind: "structural", slot: "cast" }, { kind: "generic" }]) {
  test(`project downcast ${projection.kind} keeps its physical dispatch and selected route`, () => {
    const parent = createRustProgramRecordBuilder();
    const parentRequiredRecords = [];
    const subject = {};
    const optional = rustOptionTargetType(target);
    parent.projectDowncasts.project(subject, optional, target, source, projection);
    const fact = parent.projectDowncast.get(subject);
    assert.equal(fact?.sourceCarrier === optional, true);
    assert.equal(fact.dispatchCarrier === target, true);
    assert.equal(fact.targetCarrier === source, true);
    assert.equal(fact.projection === projection, true);
    assert.equal(Object.isFrozen(fact), true);
    const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
    const childRequiredRecords = [];
    child.projectDowncasts.project(subject, { ...optional }, { ...target }, { ...source }, { ...projection });
    assert.equal(child.projectDowncast.get(subject) === fact, true);
    for (const [inputCarrier, dispatchCarrier, outputCarrier, selected] of [
      [target, target, source, projection],
      [optional, source, source, projection],
      [optional, target, target, projection],
      [optional, target, source, projection.kind === "generic" ? { kind: "closed", slot: "cast" } : { ...projection, slot: "other" }],
      [optional, target, source, projection.kind === "closed" ? { ...projection, kind: "checked" } : { kind: "closed", slot: "cast" }],
    ]) {
      assertRustInheritedRecordConflict("projectDowncast", subject, fact,
        candidate => candidate.projectDowncasts.project(subject, inputCarrier, dispatchCarrier, outputCarrier, selected),
        /Conflicting Rust semantic plan 'tsonic\.rust\.projectDowncast'/u);
      assert.equal(child.projectDowncast.get(subject) === fact, true);
    }
    const foreign = {};
    child.projectDowncasts.project(foreign, target, target, source, projection);
    assert.equal(parent.projectDowncast.get(foreign) === undefined, true);
    assert.equal(child.seal(childRequiredRecords).projectDowncast.get(subject) === fact, true);
    assert.throws(() => child.projectDowncasts.project({}, target, target, source, projection), /after analysis is sealed/u);
  });
}

test("payload upcast admission still precedes contextual conversion validation and optional publication", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const subject = {};
  const optional = rustOptionTargetType(target);
  const conversion = { kind: "option-some", source: target, element: target, elementConversion: null };
  recordRustValueCarrierReconciliation(builder, builderRequiredRecords, subject, { kind: "conversion",
    upcast: { sourceCarrier: source, targetCarrier: target },
    fact: { sourceCarrier: target, targetCarrier: optional, conversion },
  });
  assert.equal(builder.projectUpcast.get(subject)?.sourceCarrier === source, true);
  assert.equal(builder.projectUpcast.get(subject)?.targetCarrier === target, true);
  assert.equal(builder.optionProjection.get(subject)?.elementCarrier === target, true);
  assert.equal(builder.contextualValueConversion.get(subject) === undefined, true);
  const malformed = {};
  assert.throws(() => recordRustValueCarrierReconciliation(builder, builderRequiredRecords, malformed, {
    kind: "conversion", upcast: { sourceCarrier: source, targetCarrier: target },
    fact: { sourceCarrier: source, targetCarrier: optional, conversion },
  }), /exact source and selected payload/u);
  assert.equal(builder.projectUpcast.get(malformed)?.sourceCarrier === source, true);
  assert.equal(builder.optionProjection.get(malformed) === undefined, true);
  assert.equal(builder.contextualValueConversion.get(malformed) === undefined, true);
  assert.equal(builder.callScopedLifetimeReconciliation.get(malformed) === undefined, true);
});

test("an earlier inherited upcast conflict prevents later contextual records from being published", () => {
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const subject = {};
  parent.projectUpcasts.project(subject, source, target);
  const fact = parent.projectUpcast.get(subject);
  const child = createRustProgramRecordBuilder(undefined, parent.seal(parentRequiredRecords));
  const childRequiredRecords = [];
  assert.throws(() => recordRustValueCarrierReconciliation(child, childRequiredRecords, subject, {
    kind: "conversion", upcast: { sourceCarrier: target, targetCarrier: source },
    fact: { sourceCarrier: integer, targetCarrier: wide,
      conversion: { kind: "exact-integer", source: integer, target: wide } },
  }), /Conflicting Rust semantic plan 'tsonic\.rust\.projectUpcast'/u);
  assert.equal(child.projectUpcast.get(subject) === fact, true);
  assert.equal(child.contextualValueConversion.get(subject) === undefined, true);
  assert.equal(child.optionProjection.get(subject) === undefined, true);
});

test("these record families retain their existing foundation-neutral admission rule", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const string = rustStringTargetType();
  builder.callScopedLifetimes.reconcile({}, string, string);
  builder.projectUpcasts.project({}, source, string);
  builder.projectDowncasts.project({}, string, target, source, { kind: "generic" });
  assert.equal(builder.minimumFoundation(), "core");
});

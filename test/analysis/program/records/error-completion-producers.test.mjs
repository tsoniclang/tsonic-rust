import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { createRustFutureValueProducer } from "../../../../dist/analysis/program/records/callables/future-value.js";
import { createRustAwaitValueProducer } from "../../../../dist/analysis/program/records/callables/await-value.js";
import { createRustDeferredProducerEffectsProducer } from "../../../../dist/analysis/program/records/errors/deferred-producer-effects.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustErrorEffectsEqual } from "../../../../dist/analysis/errors/error-effects.js";
import { snapshotClosedMetadata } from "../../../../dist/target-model/metadata/closed-data.js";

const integer = Object.freeze({ kind: "source-primitive", name: "int32" });
const text = Object.freeze({ kind: "target-named", id: "rust.std.String" });
const nativeError = Object.freeze({ kind: "target-named", id: "acme.native.Failure" });
const identity = Object.freeze({ kind: "identity", sourceCarrier: integer, targetCarrier: integer, fallible: false });
const future = Object.freeze({ outputCarrier: integer, awaitedConversion: identity,
  awaiting: "fallible", errorBoundary: "source-native", errorCarrier: nativeError, errorSource: "input/exact" });
const pure = Object.freeze({ localErrors: false, nativeErrors: Object.freeze([]) });
const native = Object.freeze({ localErrors: false,
  nativeErrors: Object.freeze([{ identity: "input/exact", errorType: nativeError }]) });
const owners = [
  ["awaitSourceErrorEffects", "awaitSourceErrors"], ["errorEffects", "errorEffectPlans"],
  ["fallible", "fallibleSubjects"], ["genericCallableInvocation", "genericCallableInvocations"],
  ["sourceAccessorEffects", "sourceAccessorEffectPlans"], ["sourceCallEffects", "sourceCallEffectPlans"],
  ["sourceErrorEffects", "sourceErrorEdges"], ["awaitValue", "awaitValues"],
  ["futureValue", "futureValues"], ["resourceManagement", "resourceManagementPlans"],
  ["deferredProducerEffects", "deferredProducerChannels"],
];

function genericInvocation() {
  return Object.freeze({ carrier: integer, ownerFileName: "/src/exact.ts",
    effects: Object.freeze({ invocation: "fallible", awaiting: "not-applicable" }),
    invocation: Object.freeze([{ identity: "input/exact", variant: "Exact", errorType: nativeError }]),
    awaiting: Object.freeze([]) });
}

function edge(declaration) {
  return Object.freeze({ declaration, kind: "invoke", effects: native,
    nativeErrors: Object.freeze([{ source: native.nativeErrors[0], target: native.nativeErrors[0] }]) });
}

test("all eleven completion/error families expose only their exact frozen reader after sealing", () => {
  const builder = createRustProgramRecordBuilder();
  const records = builder.seal([]);
  assert.equal(Object.keys(records).length, 347, "347 sealed analysis record families, including the canonical nativeHandler and nativeTaskUse families");
  for (const [family, owner] of owners) {
    assert.equal(builder[family] === builder[owner].records, true, family);
    assert.equal(records[family] === builder[family], true, family);
    assert.equal(Object.isFrozen(records[family]), true, family);
    assert.equal(Object.isFrozen(builder[owner]), true, owner);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(records[family].get(undefined) === undefined, true, family);
    assert.equal(records[family].get({}) === undefined, true, family);
    assert.equal(builder[family].set === undefined, true, family);
    assert.equal(records[owner] === undefined, true, owner);
  }
});

test("every producer refuses work after sealing before selection or input iteration", () => {
  const builder = createRustProgramRecordBuilder();
  let selected = 0;
  const select = () => { selected += 1; throw new Error("selector must not run"); };
  const iterable = { [Symbol.iterator]: select };
  builder.futureValues.resolve({}, () => future);
  builder.seal([]);
  for (const write of [
    () => builder.awaitSourceErrors.selected({}, []),
    () => builder.errorEffectPlans.selected({}, pure),
    () => builder.fallibleSubjects.selected({}),
    () => builder.genericCallableInvocations.selected({}, genericInvocation()),
    () => builder.sourceAccessorEffectPlans.selected({}, false, undefined),
    () => builder.sourceCallEffectPlans.nativeInput({ node: {} }),
    () => builder.sourceCallEffectPlans.selected({}, "infallible", "not-applicable"),
    () => builder.sourceErrorEdges.invocation({}, []),
    () => builder.awaitValues.finalize({}, integer, integer, select, select),
    () => builder.futureValues.resolve({}, select),
    () => builder.resourceManagementPlans.select({}, {}, {}, select),
    () => builder.deferredProducerChannels.finalize(iterable),
  ]) assert.throws(write, /after analysis is sealed/u);
  assert.equal(selected, 0);
});

test("exact selected error effects retain identity, pure values and conflict refusal", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  builder.errorEffectPlans.selected(declaration, native);
  assert.throws(() => builder.errorEffectPlans.selected(declaration, { ...native }), /Duplicate Rust semantic plan/u);
  assertRustInheritedRecordCorrespondence("errorEffects", declaration, native,
    candidate => candidate.errorEffectPlans.selected(declaration, { ...native }));
  assert.equal(builder.errorEffects.get(declaration) === native, true);
  assertRustInheritedRecordConflict("errorEffects", declaration, native,
    candidate => candidate.errorEffectPlans.selected(declaration, pure), /Conflicting Rust semantic plan/u);
  const region = {};
  builder.errorEffectPlans.selected(region, pure);
  assert.equal(builder.errorEffects.get(region) === pure, true);
  assert.equal(rustErrorEffectsEqual(builder.errorEffects.get(declaration), native), true);
  assert.equal(builder.minimumFoundation(), "core");
});

test("fallibility admits the exact source identity without manufacturing a false record", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  builder.fallibleSubjects.selected(subject);
  const original = builder.fallible.get(subject);
  assert.throws(() => builder.fallibleSubjects.selected(subject), /Duplicate Rust semantic plan/u);
  assert.equal(builder.fallible.get(subject) === original, true);
  assert.deepEqual(original, { fallible: true });
  assert.equal(builder.fallible.get({}) === undefined, true);
  assert.equal(builder.minimumFoundation(), "core");
});

test("source error routes preserve exact declaration and native source/target identities", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const declaration = {};
  const route = edge(declaration);
  const routes = [route];
  builder.sourceErrorEdges.invocation(subject, routes);
  const fact = builder.sourceErrorEffects.get(subject);
  assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.edges), true);
  assert.equal(fact.edges === routes, true);
  assert.equal(fact.edges[0] === route && fact.edges[0].declaration === declaration, true);
  assert.equal(fact.edges[0].nativeErrors[0].source === native.nativeErrors[0], true);
  assertRustInheritedRecordConflict("sourceErrorEffects", subject, fact,
    candidate => candidate.sourceErrorEdges.invocation(subject, [edge({})]), /Conflicting Rust semantic plan/u);
  assert.equal(builder.sourceErrorEffects.get(subject) === fact, true);
});

test("await-source branches retain the very same selected source route and native carrier", () => {
  const builder = createRustProgramRecordBuilder();
  const route = edge({});
  const branches = Object.freeze([Object.freeze({ carrier: integer, edge: route })]);
  const subject = {};
  builder.awaitSourceErrors.selected(subject, branches);
  const fact = builder.awaitSourceErrorEffects.get(subject);
  assert.equal(Object.isFrozen(fact), true);
  assert.equal(fact.branches === branches, true);
  assert.equal(fact.branches[0].edge === route && fact.branches[0].carrier === integer, true);
  assertRustInheritedRecordConflict("awaitSourceErrorEffects", subject, fact,
    candidate => candidate.awaitSourceErrors.selected(subject,
    [{ carrier: text, edge: route }]), /Conflicting Rust semantic plan/u);
});

test("generic invocations preserve finalized physical owner and independent native channels", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const fact = genericInvocation();
  builder.genericCallableInvocations.selected(subject, fact);
  assert.equal(builder.genericCallableInvocation.get(subject) === fact, true);
  assert.equal(builder.genericCallableInvocation.get(subject).invocation[0].errorType === nativeError, true);
  assertRustInheritedRecordConflict("genericCallableInvocation", subject, fact,
    candidate => candidate.genericCallableInvocations.selected(subject,
    { ...fact, ownerFileName: "/src/foreign.ts" }), /Conflicting Rust semantic plan/u);
  assertRustInheritedRecordConflict("genericCallableInvocation", subject, fact,
    candidate => candidate.genericCallableInvocations.selected(subject,
    { ...fact, invocation: [{ ...fact.invocation[0], identity: "input/foreign" }] }), /Conflicting Rust semantic plan/u);
});

test("native call inputs construct one invocation and await channel record without erasure", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const errors = [nativeError];
  const identities = ["await/exact"];
  const input = { node: subject, invocationError: nativeError, invocationErrorSource: "input/exact",
    completion: {}, awaitErrors: errors, awaitErrorSources: identities };
  builder.sourceCallEffectPlans.nativeInput(input);
  const fact = builder.sourceCallEffects.get(subject);
  assert.equal(fact.invocation, "fallible");
  assert.equal(fact.awaiting, "fallible");
  assert.equal(fact.nativeInput.invocationError === nativeError, true);
  assert.equal(fact.nativeInput.invocationErrorSource, "input/exact");
  assert.equal(fact.nativeInput.awaitErrors === errors && fact.nativeInput.awaitErrorSources === identities, true);
  assertRustInheritedRecordConflict("sourceCallEffects", subject, fact,
    candidate => candidate.sourceCallEffectPlans.nativeInput({ ...input,
    invocationErrorSource: "input/foreign" }), /Conflicting Rust semantic plan/u);
  const sync = {};
  builder.sourceCallEffectPlans.nativeInput({ ...input, node: sync, completion: undefined });
  assert.equal(builder.sourceCallEffects.get(sync).awaiting, "not-applicable");
});

test("selected source call branches preserve ordering, false effects and explicit absence", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const branches = [{ invocation: "infallible", awaiting: "not-applicable" },
    { invocation: "fallible", awaiting: "fallible" }];
  builder.sourceCallEffectPlans.selected(subject, "fallible", "fallible", branches);
  assert.equal(builder.sourceCallEffects.get(subject).unionBranches === branches, true);
  assertRustInheritedRecordConflict("sourceCallEffects", subject, builder.sourceCallEffects.get(subject),
    candidate => candidate.sourceCallEffectPlans.selected(subject,
    "infallible", "fallible", branches), /Conflicting Rust semantic plan/u);
  const pureSubject = {};
  builder.sourceCallEffectPlans.selected(pureSubject, "infallible", "not-applicable");
  assert.deepEqual(builder.sourceCallEffects.get(pureSubject), { invocation: "infallible", awaiting: "not-applicable" });
});

test("accessor construction distinguishes absent sides from proven infallible sides", () => {
  const builder = createRustProgramRecordBuilder();
  for (const [read, write, expected] of [[undefined, undefined, {}],
    [false, undefined, { read: "infallible" }], [undefined, true, { write: "fallible" }],
    [true, false, { read: "fallible", write: "infallible" }]]) {
    const subject = {};
    builder.sourceAccessorEffectPlans.selected(subject, read, write);
    assert.deepEqual(builder.sourceAccessorEffects.get(subject), expected);
  }
});

test("future resolution owns recursion, absence, exact selected value and recovery after failure", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  let selections = 0;
  assert.equal(builder.futureValues.resolve(subject, () => {
    selections += 1;
    assert.equal(builder.futureValues.resolve(subject, () => { throw new Error("recursive selector"); }) === undefined, true);
    return future;
  }) === future, true);
  assert.equal(builder.futureValues.resolve(subject, () => { throw new Error("duplicate selection"); }) === future, true);
  assert.equal(builder.futureValue.get(subject) === future, true);
  assert.equal(selections, 1);
  const missing = {};
  assert.equal(builder.futureValues.resolve(missing, () => undefined) === undefined, true);
  assert.equal(builder.futureValue.get(missing) === undefined, true);
  assert.throws(() => builder.futureValues.resolve(missing, () => { throw new Error("actual defect"); }), /actual defect/u);
  assert.equal(builder.futureValues.resolve(missing, () => future) === future, true);
});

test("future native accounting happens once on resolution and never on cached reads", () => {
  let accounted = 0;
  const foundations = [];
  const owner = createRustFutureValueProducer(() => {}, foundation => {
    accounted += 1; foundations.push(foundation);
  }, emptyRustTypeDefinitions);
  const subject = {};
  owner.resolve(subject, () => future);
  for (let index = 0; index < 64; index += 1) {
    assert.equal(owner.records.get(subject) === future, true);
    assert.equal(owner.resolve(subject, () => { throw new Error("cached selection"); }) === future, true);
  }
  assert.equal(accounted, 1);
  assert.deepEqual(foundations, ["std"]);
});

test("await finalization uses the canonical conversion and never admits an unproven branch", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const fact = builder.awaitValues.finalize(subject, integer, integer, () => undefined, () => undefined);
  assert.equal(fact !== undefined, true);
  assert.equal(builder.awaitValue.get(subject) === fact, true);
  assert.equal(fact.operandCarrier.kind, "source-primitive");
  assert.equal(fact.selection.kind, "leaf");
  assert.equal(fact.selection.value.completion.kind, "value");
  assert.equal(fact.selection.value.completion.conversion.kind, "identity");
  assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.selection), true);
  const rejected = {};
  assert.equal(builder.awaitValues.finalize(rejected, integer, text, () => undefined, () => undefined) === undefined, true);
  assert.equal(builder.awaitValue.get(rejected) === undefined, true);
});

test("await foundation tracks exact finalized semantic conversions and refuses conflicts before accounting", () => {
  const foundations = [];
  const owner = createRustAwaitValueProducer(() => {}, value => foundations.push(value), emptyRustTypeDefinitions);
  const floating = { kind: "source-primitive", name: "float64" };
  const subject = {};
  const selected = owner.finalize(subject, floating, integer, () => undefined,
    () => ({ kind: "semantic-conversion", id: "checked-f64-to-i32-trunc" }));
  assert.equal(selected !== undefined, true);
  assert.deepEqual(foundations, ["alloc"]);
  const incompatible = createRustAwaitValueProducer(() => {}, value => foundations.push(value), emptyRustTypeDefinitions, owner.records);
  assert.throws(() => incompatible.finalize(subject, floating, floating, () => undefined, () => undefined), /Conflicting Rust semantic plan/u);
  assert.deepEqual(foundations, ["alloc"]);
  assert.equal(owner.records.get(subject) === selected, true);
});

test("deferred completion batches retain finalized native channels, identity, order and admission accounting", () => {
  const foundations = [];
  const owner = createRustDeferredProducerEffectsProducer(() => {}, value => foundations.push(value));
  const first = {};
  const second = {};
  const channels = [{ awaiting: "infallible", errorCarrier: integer }, { awaiting: "fallible", errorCarrier: nativeError }];
  const selected = snapshotClosedMetadata({ kind: "futures", channels });
  owner.finalize(new Map([[first, { kind: "no-future" }], [second, selected]]));
  assert.deepEqual(foundations, ["core", "std"]);
  const fact = owner.records.get(second);
  assert.equal(fact === selected, true);
  assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.channels) && Object.isFrozen(fact.channels[0]), true);
  assert.deepEqual(fact.channels.map(value => value.awaiting), ["infallible", "fallible"]);
  channels[0].errorCarrier = text;
  assert.equal(fact.channels[0].errorCarrier.name, "int32");
  const incompatible = createRustDeferredProducerEffectsProducer(() => {}, value => foundations.push(value), owner.records);
  assert.throws(() => incompatible.finalize(new Map([[second, { kind: "no-future" }]])), /Conflicting Rust semantic plan/u);
  assert.deepEqual(foundations, ["core", "std"]);
  assert.equal(owner.records.get(second) === fact, true);
});

test("resource rejection leaves the family empty and preserves the exact selector reason", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const selected = builder.resourceManagementPlans.select(declaration,
    { semanticsFor: () => ({ operations: { resourceManagement: () => undefined } }) }, {}, () => undefined);
  assert.equal(selected.kind, "rejected");
  assert.equal(selected.reason, "TSTS did not retain exact checked resource-management evidence for this declaration.");
  assert.equal(builder.resourceManagement.get(declaration) === undefined, true);
  assert.equal(builder.minimumFoundation(), "core");
});

test("inherited error, source route and future evidence remains exact without mutating its parent", () => {
  const parent = createRustProgramRecordBuilder();
  const subject = {};
  const route = edge({});
  parent.errorEffectPlans.selected(subject, native);
  parent.sourceErrorEdges.invocation(subject, [route]);
  parent.futureValues.resolve(subject, () => future);
  const inherited = parent.seal([]);
  const child = createRustProgramRecordBuilder(undefined, inherited);
  child.errorEffectPlans.selected(subject, { ...native });
  child.sourceErrorEdges.invocation(subject, [route]);
  assert.equal(child.errorEffects.get(subject) === inherited.errorEffects.get(subject), true);
  assert.equal(child.sourceErrorEffects.get(subject) === inherited.sourceErrorEffects.get(subject), true);
  assert.equal(child.futureValues.resolve(subject, () => { throw new Error("inherited selection"); }) === future, true);
  assert.equal(child.minimumFoundation(), "core", "an inherited cached future is not re-published");
  const fresh = {};
  child.futureValues.resolve(fresh, () => future);
  assert.equal(child.minimumFoundation(), "std");
  assert.equal(inherited.futureValue.get(fresh) === undefined, true);
});

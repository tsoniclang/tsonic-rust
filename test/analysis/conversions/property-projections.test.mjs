import assert from "node:assert/strict";
import test from "node:test";
import { rustPropertyProjectionFactEquals } from "../../../dist/target-model/records/operations/operation-equality.js";
import { createRustPropertyProjectionSelector,
  selectRustPropertyProjectionCase } from "../../../dist/analysis/conversions/property-projections.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { rustSourcePrimitiveTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

function fixture() {
  const scalar = rustSourcePrimitiveTargetType("uint64");
  const source = rustStructuralObjectTargetType("/src/options.ts", [
    { sourceName: "unrelated", presence: "required", readonly: true, type: scalar },
    { sourceName: "selected", presence: "required", readonly: true, type: scalar },
  ]);
  const sourceType = {};
  const destination = {};
  const symbol = {};
  const declaration = {};
  const field = { storageIndex: 1, resultCarrier: scalar, presence: "required", readonly: true };
  const registration = { shape: { storage: "structural-object" }, field };
  const member = { read: "property", property: { name: "selected", symbol, optional: false }, declarations: [declaration], getters: [] };
  const correspondence = { kind: "available", destination: { calls: [], constructs: [], indexes: [] },
    members: [{ kind: "present", source: member, destination: member }] };
  const context = { typeDefinitions: emptyRustTypeDefinitions, currentSemantics: { types: {
    structuralMembers(actual, required, purpose) {
      assert.equal(actual === sourceType && required === destination, true, "exact checked source and destination identity");
      assert.equal(purpose, "read", "runtime projection requires a readable checked source member");
      return correspondence;
    },
  } } };
  const options = { projectTypes: { definitionContainingDeclaration: () => undefined }, sourceTypes: {
    structuralFieldProjectionForSymbol: subject => subject === symbol ? registration : undefined,
    structuralFieldProjectionForDeclaration: subject => subject === declaration ? registration : undefined,
  } };
  return { source, sourceType, destination, scalar, field, correspondence, context, options };
}

function select(input, reserve = () => true) {
  return selectRustPropertyProjectionCase(input.sourceType, input.destination, input.source, input.context, input.options, reserve);
}

test("selected property projection preserves checked identities and omits unrelated members", () => {
  const input = fixture();
  const projection = select(input);
  assert.equal(projection?.source === input.source, true, "exact native source carrier");
  assert.equal(projection.conversion.fields.length, 1);
  assert.equal(projection.conversion.fields[0].sourceName, "selected");
  assert.equal(projection.reads[0].storageIndex, 1);
  assert.equal(Object.isFrozen(projection) && Object.isFrozen(projection.reads) &&
    Object.isFrozen(projection.reads[0].valueSemantics) && Object.isFrozen(projection.conversion.fields[0]), true);
});

test("selected property projection rejects missing, unreadable, duplicated and open evidence", () => {
  for (const mutate of [
    input => { input.correspondence.kind = "unavailable"; },
    input => { input.correspondence.destination.indexes.push({}); },
    input => { input.correspondence.destination.calls.push({}); },
    input => { input.correspondence.destination.constructs.push({}); },
    input => { input.correspondence.members[0].source = { ...input.correspondence.members[0].source, read: "unavailable" }; },
    input => { input.correspondence.members[0].source = { ...input.correspondence.members[0].source, read: "method" }; },
    input => { input.correspondence.members[0].source = { ...input.correspondence.members[0].source,
      property: { name: "selected", symbol: {}, optional: false }, declarations: [{}] }; },
    input => { input.correspondence.members.push(input.correspondence.members[0]); },
    input => { input.correspondence.members[0] = { kind: "absent", destination: input.correspondence.members[0].destination }; },
    input => { input.correspondence.members[0].source = { ...input.correspondence.members[0].source,
      property: { ...input.correspondence.members[0].source.property, optional: true } }; },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(select(input) === undefined, true, "mutated exact correspondence rejects without native output");
  }
  assert.equal(select(fixture(), () => false) === undefined, true, "finite reservation rejects before native selection");
});

test("selected property projection accepts genuinely absent optional destination members", () => {
  const input = fixture();
  input.correspondence.members[0] = { kind: "absent", destination: {
    ...input.correspondence.members[0].destination,
    property: { ...input.correspondence.members[0].destination.property, optional: true },
  } };
  const projection = select(input);
  assert.equal(projection?.conversion.fields.length === 0 && projection.reads.length === 0, true, "exact optional absence");
});

test("selected optional property demand retains its exact native storage element", () => {
  const input = fixture();
  input.correspondence.members[0].source = { ...input.correspondence.members[0].source,
    property: { ...input.correspondence.members[0].source.property, optional: true } };
  input.field.resultCarrier = rustOptionTargetType(input.scalar);
  const projection = select(input);
  assert.equal(projection?.conversion.fields[0].presence, "optional");
  assert.equal(projection.conversion.fields[0].sourceCarrier === input.scalar, true, "native uint64 is not rounded through float64");
  assert.equal(projection.reads[0].resultCarrier === input.field.resultCarrier, true, "physical optional storage remains exact");
});

function selectorFixture(builder = createRustProgramRecordBuilder(), expression = {}) {
  const input = fixture();
  const types = input.context.currentSemantics.types;
  const nativeMembers = types.structuralMembers;
  let selections = 0;
  let admissions = 0;
  types.structuralMembers = (...args) => { selections += 1; return nativeMembers(...args); };
  types.nonNullableType = type => type;
  types.isNullish = () => false;
  types.isUnion = () => false;
  const records = { ...builder, propertyProjections: { ...builder.propertyProjections,
    finalize: (...args) => { admissions += 1; return builder.propertyProjections.finalize(...args); } } };
  input.context.records = records;
  input.context.requiredRecords = [];
  const request = { source: { sourceArguments: [{ expression, type: input.sourceType }],
    sourceArgumentBindings: [{ sourceArgumentIndex: 0, sourceForm: "value", selectedParameterType: input.destination }] } };
  return { ...input, builder, expression, request, selections: () => selections, admissions: () => admissions,
    select: () => createRustPropertyProjectionSelector(request, input.context, input.options, [input.source]) };
}

test("per-call property queries select once and return the complete canonical conversion", () => {
  const input = selectorFixture();
  const query = input.select();
  const first = query(0);
  const fact = input.builder.propertyProjection.get(input.expression);
  assert.equal(first !== undefined && first === fact?.conversion, true, "canonical full property selection");
  assert.equal(query(0) === first, true);
  assert.equal(input.selections(), 1);
  assert.equal(input.admissions(), 1);
  assert.equal(fact.cases.length, 1);
  const another = input.select();
  assert.equal(another(0) === first, true, "new call request revalidates and retains canonical conversion identity");
  assert.equal(input.selections(), 2);
  assert.equal(input.admissions(), 1, "another request never repeats the actual constructor");
  assert.throws(() => input.builder.propertyProjections.finalize(input.expression, first, fact.cases), /Duplicate Rust semantic plan/u);
  const child = createRustProgramRecordBuilder(undefined, input.builder.seal(input.context.requiredRecords));
  const inherited = selectorFixture(child, input.expression);
  assert.equal(inherited.select()(0) === first, true, "an inherited query selects before reusing full native evidence");
  assert.equal(inherited.selections(), 1);
  assert.equal(inherited.admissions(), 0);
  assert.equal(child.minimumFoundation(), "core");
  assert.throws(() => query(0), /after analysis is sealed/u);
  assert.throws(() => input.select()(999), /after analysis is sealed/u);
});

test("equal property conversions cannot conceal changed native read cases", () => {
  const input = selectorFixture();
  const first = input.select()(0);
  const fact = input.builder.propertyProjection.get(input.expression);
  input.field.storageIndex = 0;
  assert.equal(input.select()(0) === undefined, true, "same conversion with a different physical read refuses");
  assert.equal(input.builder.propertyProjection.get(input.expression) === fact, true);
  assert.equal(fact.conversion === first && fact.cases[0].reads[0].storageIndex === 1, true);
  assert.equal(input.admissions(), 1);
});

test("property selector failure at a later argument preserves the earlier complete admission", () => {
  const input = selectorFixture();
  const second = {};
  input.request.source.sourceArguments.push({ expression: second, type: input.sourceType });
  input.request.source.sourceArgumentBindings.push({ ...input.request.source.sourceArgumentBindings[0], sourceArgumentIndex: 1 });
  const query = createRustPropertyProjectionSelector(input.request, input.context, input.options, [input.source, input.source]);
  const first = query(0);
  const canonical = input.builder.propertyProjection.get(input.expression);
  input.correspondence.kind = "unavailable";
  assert.equal(query(1) === undefined, true);
  assert.equal(input.builder.propertyProjection.get(second) === undefined, true);
  assert.equal(input.builder.propertyProjection.get(input.expression) === canonical && query(0) === first, true);
  assert.equal(input.admissions(), 1);
  assert.equal(input.selections(), 2);
});

test("optional property-source queries retain the original ordered inner native read cases", () => {
  const input = selectorFixture();
  const query = createRustPropertyProjectionSelector(input.request, input.context, input.options,
    [rustOptionTargetType(input.source)]);
  const selected = query(0);
  const canonical = input.builder.propertyProjection.get(input.expression);
  assert.equal(selected !== undefined && canonical?.cases.length === 1, true);
  assert.equal(canonical.cases[0].source === input.source, true);
  assert.equal(canonical.cases[0].reads[0].storageIndex, 1);
  assert.equal(query(0) === canonical.conversion, true);
  assert.equal(input.selections(), 1);
});

test("property queries preserve optional presence, local failed caching and closed callback order", () => {
  const input = selectorFixture();
  input.correspondence.members[0].source = { ...input.correspondence.members[0].source,
    property: { ...input.correspondence.members[0].source.property, optional: true } };
  input.field.resultCarrier = rustOptionTargetType(input.scalar);
  const query = input.select();
  const selected = query(0);
  assert.equal(selected !== undefined, true);
  assert.equal(input.builder.propertyProjection.get(input.expression).cases[0].conversion.fields[0].presence, "optional");
  const refused = selectorFixture();
  refused.correspondence.kind = "unavailable";
  const failure = refused.select();
  assert.equal(failure(0) === undefined, true);
  assert.equal(failure(0) === undefined, true);
  assert.equal(refused.selections(), 1, "fixed argument failure is cached locally, not published");
  assert.equal(refused.admissions(), 0);
  assert.equal(refused.builder.propertyProjection.get(refused.expression) === undefined, true);
  refused.builder.seal(refused.context.requiredRecords);
  const unexpected = new Proxy({}, { get: () => assert.fail("closed query reads checked source") });
  const closed = createRustPropertyProjectionSelector(unexpected, refused.context, refused.options, []);
  assert.throws(() => closed(0), /after analysis is sealed/u);
  assert.throws(() => failure(0), /after analysis is sealed/u);
});

test("full property fact equality preserves exact member identities, ordered cases and accessor metadata", () => {
  const selected = select(fixture());
  const read = selected.reads[0];
  const fact = { conversion: selected.conversion, cases: [selected] };
  const changedRead = value => ({ ...fact, cases: [{ ...selected, reads: [value] }] });
  assert.equal(rustPropertyProjectionFactEquals(fact, changedRead({ ...read })), true);
  for (const changed of [
    { ...read, receiverCarrier: rustSourcePrimitiveTargetType("int32") },
    { ...read, resultCarrier: rustSourcePrimitiveTargetType("int32") },
    { ...read, declaration: {} }, { ...read, declaration: undefined }, { ...read, dispatch: undefined },
    { ...read, storageIndex: 0 }, { ...read, valueSemantics: { kind: "accessor", writable: false } },
    { ...read, dispatch: { read: "get", write: "set", ownerCarrier: selected.source } },
  ]) assert.equal(rustPropertyProjectionFactEquals(fact, changedRead(changed)), false, "changed complete property read");
  assert.equal(rustPropertyProjectionFactEquals(fact, { ...fact, cases: [] }), false);
  const accessor = { kind: "source-accessor", receiver: { kind: "instance" }, resultCarrier: read.resultCarrier,
    read: { declaration: {}, method: "get", resultCarrier: read.resultCarrier },
    write: { declaration: {}, method: "set", valueCarrier: read.resultCarrier },
    dispatch: { ownerCarrier: selected.source } };
  const accessFact = changedRead(accessor);
  assert.equal(rustPropertyProjectionFactEquals(accessFact, changedRead({ ...accessor, read: { ...accessor.read } })), true);
  for (const changed of [
    { ...accessor, read: { ...accessor.read, declaration: {} } },
    { ...accessor, read: { ...accessor.read, method: "other" } },
    { ...accessor, write: { ...accessor.write, method: "other" } },
    { ...accessor, receiver: { kind: "static", typeCarrier: selected.source } },
    { ...accessor, dispatch: { ownerCarrier: read.resultCarrier } },
  ]) assert.equal(rustPropertyProjectionFactEquals(accessFact, changedRead(changed)), false, "changed native accessor");
  const paired = { ...fact, cases: [selected, { ...selected, reads: [accessor] }] };
  assert.equal(rustPropertyProjectionFactEquals(paired, { ...paired, cases: [...paired.cases].reverse() }), false);
});

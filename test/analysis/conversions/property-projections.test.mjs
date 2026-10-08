import assert from "node:assert/strict";
import test from "node:test";
import { selectRustPropertyProjectionCase } from "../../../dist/analysis/conversions/property-projections.js";
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
    structuralMembers(actual, required) {
      assert.equal(actual === sourceType && required === destination, true, "exact checked source and destination identity");
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

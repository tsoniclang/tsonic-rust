import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { rustStructuralGenericCarrier } from "../../../dist/analysis/objects/structural-generic-carrier.js";
import { retainRustStructuralInstantiation } from "../../../dist/policy/types/resolution/structural-instantiations.js";
import { rustGenericsWithAssociatedBounds } from "../../../dist/backend/planner/types/generic-bounds.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";

const scalar = { kind: "source-primitive", name: "int32" };
const parameter = { kind: "type-parameter", name: "T" };
const projection = identity => ({ kind: "associated-type", owner: parameter, name: "Output",
  trait: { kind: "trait-ref", id: identity, path: identity,
    sourceItem: { fileName: "/source.ts", typeName: identity }, genericArguments: [], associatedConstraints: [] } });
const field = (name, type) => ({ sourceName: name, type, presence: "required", readonly: false });
const carrier = types => rustStructuralObjectTargetType("/source.ts", types.map((type, index) => field(`field${index}`, type)));

test("dependent generic bounds occupy one location without changing bound-lifetime predicates", () => {
  const clone = { kind: "trait", path: "Clone" };
  const storage = { kind: "trait", path: "Storage" };
  const parameter = { kind: "type", name: "Element", bounds: [clone], defaultType: { kind: "primitive", name: "i32" } };
  const predicate = { kind: "type", type: { kind: "named", path: "Element" }, bounds: [storage, clone] };
  const selected = rustGenericsWithAssociatedBounds([parameter], [predicate]);
  assert.deepEqual(selected.parameters[0], { ...parameter, bounds: [] });
  assert.deepEqual(selected.wherePredicates[0].bounds, [clone, storage]);
  assert.deepEqual(parameter.bounds, [clone]);
  assert.deepEqual(predicate.bounds, [storage, clone]);
  const bound = { ...predicate, binder: [{ kind: "lifetime", name: "item", outlives: [] }] };
  assert.deepEqual(rustGenericsWithAssociatedBounds([parameter], [bound]), { parameters: [parameter], wherePredicates: [bound] });
});

function fixture() {
  const sourceTypes = createRustSourceTypeRegistry();
  const templateCarrier = carrier([projection("Storage"), projection("Container")]);
  const selectedCarrier = carrier([scalar, scalar]);
  const templateType = {};
  const selectedType = {};
  const declarations = [{}, {}];
  const symbols = [{}, {}];
  const selectedSymbols = [{}, {}];
  const fields = rustStructuralObjectCarrierValue(templateCarrier).fields.map((entry, index) => ({
    ...entry, declarations: [declarations[index]], symbols: [symbols[index]],
    sourceType: {}, resultCarrier: entry.type, storageIndex: index,
  }));
  assert.equal(sourceTypes.registerStructuralObject({ sourceType: templateType, carrier: templateCarrier,
    storage: "structural-object", fields }), true);
  const member = (symbol, declaration) => ({ property: { symbol, rootSymbols: [], optional: false, readonly: false, type: {} },
    declarations: [declaration], getters: [], setters: [], read: "property" });
  const correspondence = { kind: "available",
    source: { type: selectedType, calls: [], constructs: [], indexes: [] },
    destination: { type: templateType, calls: [], constructs: [], indexes: [] },
    members: fields.map((entry, index) => ({ kind: "present",
      source: member(selectedSymbols[index], declarations[index]),
      destination: member(symbols[index], declarations[index]),
    })).reverse(),
  };
  const context = { ast: { kindName: () => "KindPropertySignature", typeNode: () => undefined },
    currentSemantics: { types: { aliasApplication: () => undefined, structuralMembers(source, destination) {
    assert.equal(source, selectedType);
    assert.equal(destination, templateType);
    return correspondence;
  } } } };
  return { sourceTypes, templateCarrier, selectedCarrier, templateType, selectedType, declarations, selectedSymbols,
    correspondence, context, retain() {
      return retainRustStructuralInstantiation(selectedType, templateCarrier, selectedCarrier, context, { sourceTypes });
    } };
}

test("structural storage parameterizes independent family outputs without reversing their source argument", () => {
  const template = carrier([projection("Storage"), projection("Container"), projection("Storage"),
    { kind: "type-parameter", name: "Storage0" }]);
  const fields = rustStructuralObjectCarrierValue(rustStructuralGenericCarrier(template)).fields;
  assert.deepEqual(fields.map(entry => entry.type.name), ["Storage1", "Storage2", "Storage1", "Storage0"]);
  assert.deepEqual(rustStructuralGenericCarrier(carrier([scalar])), carrier([scalar]));
});

test("selected record instantiation retains exact reordered members and one generic native storage", () => {
  const input = fixture();
  assert.equal(input.retain(), true);
  assert.equal(input.retain(), true);
  assert.equal(input.sourceTypes.structuralInstantiations().length, 1);
  assert.equal(input.sourceTypes.structuralObjects().length, 2);
  for (let index = 0; index < 2; index += 1) {
    const selected = input.sourceTypes.structuralFieldProjectionForSymbol(input.selectedSymbols[index], input.selectedCarrier);
    assert.equal(selected.field.storageIndex, index);
    assert.deepEqual(selected.field.resultCarrier, scalar);
    assert.deepEqual(selected.field.declarations, [input.declarations[index]]);
  }
  const plan = createRustStructuralShapePlan(input.sourceTypes.structuralObjects(), [], () => "source", [],
    input.sourceTypes.structuralInstantiations());
  assert.equal(plan.definitions.length, 1);
  assert.equal(plan.definitions[0].genericParameters.length, 2);
  assert.deepEqual(plan.definitionForCarrier(plan.definitions[0].carrier), plan.definitions[0]);
  assert.deepEqual(plan.definitionForCarrier(plan.definitions[0].carrier).genericArguments.map(argument => argument.type),
    [{ kind: "type-parameter", name: "Storage0" }, { kind: "type-parameter", name: "Storage1" }]);
  const selected = plan.definitionForCarrier(input.selectedCarrier);
  assert.deepEqual(selected.genericArguments.map(argument => argument.type), [scalar, scalar]);
  assert.deepEqual(selected.fields.map(entry => entry.carrier), [scalar, scalar]);
  assert.equal(plan.definitionForCarrier(input.templateCarrier).genericArguments.length, 2);
});

test("record instantiation preserves independently declared source members through exact correspondence", () => {
  const input = fixture();
  const sourceDeclarations = [{}, {}];
  input.correspondence.members.forEach((pair, index) => {
    pair.source.declarations = [sourceDeclarations[index]];
  });
  assert.equal(input.retain(), true);
  for (const pair of input.correspondence.members) {
    const selected = input.sourceTypes.structuralFieldProjectionForSymbol(pair.source.property.symbol, input.selectedCarrier);
    assert.deepEqual(selected.field.declarations, pair.source.declarations);
    assert.deepEqual(selected.field.resultCarrier, scalar);
  }
});

test("nonstructural nested arrays do not request structural instantiation metadata", () => {
  const nested = { kind: "array", element: { kind: "array", element: scalar } };
  const context = { currentSemantics: { types: new Proxy({}, { get() {
    throw new Error("No structural metadata is needed for scalar array storage");
  } }) } };
  assert.equal(retainRustStructuralInstantiation({}, nested, nested, context, {}), true);
});

test("record instantiation rejects missing, duplicated, foreign destination and incompatible selected members", () => {
  for (const mutate of [
    input => { input.correspondence.members[0] = { ...input.correspondence.members[0], kind: "absent" }; },
    input => { input.correspondence.members[0] = input.correspondence.members[1]; },
    input => { input.correspondence.members[0].destination.declarations = [{}]; },
    input => { input.correspondence.members[0].source.property.optional = true; },
    input => { input.correspondence.members[0].source.property.readonly = true; },
    input => { input.correspondence.members[0].source.read = "accessor"; },
    input => { input.correspondence.source.indexes = [{}]; },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(input.retain(), false);
    assert.equal(input.sourceTypes.structuralObjects().length, 1);
    assert.equal(input.sourceTypes.structuralInstantiations().length, 0);
  }
});

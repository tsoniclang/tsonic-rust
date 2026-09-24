import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { rustStructuralGenericCarrier } from "../../../dist/analysis/objects/structural-generic-carrier.js";
import { retainRustStructuralInstantiation } from "../../../dist/policy/types/resolution/structural-instantiations.js";
import { rustGenericsWithAssociatedBounds } from "../../../dist/backend/planner/types/generic-bounds.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { selectRustStructuralFieldProjection } from "../../../dist/policy/types/structural-fields.js";

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

test("exact structural alias instances retain their generic root in either registration order", () => {
  const declaration = {};
  const otherDeclaration = {};
  const root = carrier([parameter]);
  const middle = carrier([{ kind: "array", element: parameter }]);
  const selected = carrier([{ kind: "array", element: scalar }]);
  const shape = (selectedCarrier, sourceAlias) => ({
    sourceType: {}, sourceAlias, carrier: selectedCarrier, storage: "structural-object",
    fields: rustStructuralObjectCarrierValue(selectedCarrier).fields.map((entry, storageIndex) => ({
      ...entry, declarations: [], symbols: [], sourceType: {}, resultCarrier: entry.type, storageIndex,
    })),
  });
  for (const aliasFirst of [true, false]) {
    const registry = createRustSourceTypeRegistry();
    assert.equal(registry.registerStructuralObject(shape(root, declaration)), true);
    if (aliasFirst) assert.equal(registry.registerRepresentationAlias(declaration, root), true);
    const partial = shape(middle, declaration);
    assert.equal(registry.registerStructuralObject(partial), true);
    assert.equal(registry.registerStructuralObject(partial), true);
    assert.equal(registry.registerStructuralObject(shape(selected, otherDeclaration), middle), true);
    if (!aliasFirst) assert.equal(registry.registerRepresentationAlias(declaration, root), true);
    assert.equal(registry.registerRepresentationAlias(declaration, root), true);
    assert.equal(registry.structuralInstantiations().length, 2);
    assert.equal(registry.registerRepresentationAlias(declaration, selected), false);
    assert.equal(registry.structuralInstantiations().length, 2);
    const plan = createRustStructuralShapePlan(registry.structuralObjects(), [], () => "source", [],
      registry.structuralInstantiations());
    assert.equal(plan.definitions.length, 1);
    assert.deepEqual(plan.definitionForCarrier(selected).genericArguments, [{ kind: "type", type: {
      kind: "array", element: scalar,
    } }]);
    assert.equal(registry.registerRepresentationAlias(otherDeclaration, scalar), false);
    assert.equal(registry.structuralInstantiations().length, 2);
    assert.equal(registry.structuralObjects()[1].sourceAlias, declaration);
    assert.equal(Object.isFrozen(registry.structuralObjects()[1]), true);
  }
});

test("structural alias registration never joins unrelated declarations by their shape", () => {
  const registry = createRustSourceTypeRegistry();
  const declaration = {};
  const otherDeclaration = {};
  const root = carrier([parameter]);
  const selected = carrier([scalar]);
  assert.equal(registry.registerStructuralObject({ sourceType: {}, sourceAlias: declaration,
    carrier: root, storage: "structural-object", fields: [] }), true);
  assert.equal(registry.registerStructuralObject({ sourceType: {}, sourceAlias: otherDeclaration,
    carrier: selected, storage: "structural-object", fields: [] }), true);
  assert.equal(registry.registerRepresentationAlias(declaration, root), true);
  assert.deepEqual(registry.structuralInstantiations(), []);
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
  const fields = rustStructuralObjectCarrierValue(rustStructuralGenericCarrier(template).carrier).fields;
  assert.deepEqual(fields.map(entry => entry.type.name), ["Storage1", "Storage2", "Storage1", "Storage0"]);
  assert.deepEqual(rustStructuralGenericCarrier(carrier([scalar])).carrier, carrier([scalar]));
});

test("nested structural family storage retains exact child definitions and independent argument positions", () => {
  const inner = carrier([projection("Storage"), projection("Container")]);
  const outer = carrier([projection("Container"), inner]);
  const plan = createRustStructuralShapePlan([{ carrier: inner }, { carrier: outer }], [], () => "source", []);
  const outerDefinition = plan.definitionForCarrier(outer);
  const canonical = plan.definitions.find(definition => definition.targetName === outerDefinition.targetName);
  const child = plan.definitionForCarrier(canonical.fields[1].carrier);
  assert.equal(plan.definitions.length, 2);
  assert.equal(child.targetName, plan.definitionForCarrier(inner).targetName);
  assert.deepEqual(child.genericArguments.map(argument => argument.type.name), ["Storage1", "Storage0"]);
  assert.deepEqual(child.fields.map(field => field.carrier.name), ["Storage1", "Storage0"]);
  assert.throws(() => createRustStructuralShapePlan([{ carrier: outer }], [], () => "source", []),
    /missing its checked source definition/u);
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

test("structural projections join exact declarations across fresh symbols and reject conflicting evidence", () => {
  const input = fixture();
  assert.equal(input.retain(), true);
  const select = (symbol, declarations) => selectRustStructuralFieldProjection(input.sourceTypes,
    symbol, declarations, input.selectedCarrier);
  const field = select({}, [input.declarations[0]]);
  assert.equal(field.field.storageIndex, 0);
  assert.deepEqual(field.field.resultCarrier, scalar);
  assert.equal(select({}, [{}]), undefined);
  assert.equal(select(input.selectedSymbols[1], [input.declarations[0]]), undefined);
  assert.equal(select({}, input.declarations), undefined);
  assert.deepEqual(select(input.selectedSymbols[0], [input.declarations[0]]), field);
});

test("an already registered exact structural selection does not repeat recursive source queries", () => {
  const input = fixture();
  assert.equal(input.retain(), true);
  const context = { currentSemantics: { types: new Proxy({}, { get() {
    throw new Error("Exact retained structural evidence must not be reconstructed");
  } }) } };
  for (let index = 0; index < 256; index += 1) {
    assert.equal(retainRustStructuralInstantiation(input.selectedType,
      structuredClone(input.selectedCarrier), structuredClone(input.selectedCarrier),
      context, { sourceTypes: input.sourceTypes }), true);
  }
  assert.equal(input.sourceTypes.structuralObjects().length, 2);
  assert.equal(input.sourceTypes.structuralInstantiations().length, 1);
});

test("structural proof reuse requires both exact source identity and target carrier", () => {
  const input = fixture();
  let queries = 0;
  const context = { ...input.context, currentSemantics: { types: {
    ...input.context.currentSemantics.types,
    structuralMembers() {
      queries += 1;
      return { kind: "unavailable" };
    },
  } } };
  const options = { sourceTypes: input.sourceTypes };
  assert.equal(retainRustStructuralInstantiation(input.selectedType,
    input.templateCarrier, input.templateCarrier, context, options), false);
  assert.equal(retainRustStructuralInstantiation(input.templateType,
    input.templateCarrier, input.selectedCarrier, context, options), false);
  assert.equal(queries, 2);
  assert.equal(input.sourceTypes.structuralObjects().length, 1);
  assert.equal(input.sourceTypes.structuralInstantiations().length, 0);
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

import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/shapes/structural-shape-plan.js";
import { rustStructuralGenericCarrier } from "../../../dist/policy/types/objects/structural-generics.js";
import { retainRustStructuralInstantiation } from "../../../dist/analysis/source-evidence/types/resolution/structural-instantiations.js";
import { rustGenericsWithAssociatedBounds } from "../../../dist/backend/planner/types/generic-bounds.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { selectRustStructuralFieldProjection } from "../../../dist/policy/types/objects/structural-fields.js";
import { closedMetadataKey } from "../../../dist/target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { bindRustStructuralImplementationContract } from "../../../dist/policy/types/objects/structural-storage.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustLifetimesEqual } from "../../../dist/target-model/lifetimes/index.js";

const scalar = { kind: "source-primitive", name: "int32" };
const parameter = { kind: "type-parameter", identity: "T", name: "T" };
const projection = identity => ({ kind: "associated-type", owner: parameter, name: "Output",
  trait: { kind: "trait-ref", id: identity, path: identity,
    sourceItem: { fileName: "/source.ts", typeName: identity }, genericArguments: [], associatedConstraints: [] } });
const field = (name, type) => ({ sourceName: name, type, presence: "required", readonly: false });
const carrier = types => rustStructuralObjectTargetType("/source.ts", types.map((type, index) => field(`field${index}`, type)));

test("structural method contracts select only actual source placeholder lifetimes before strict binding", () => {
  const object = callable => rustStructuralObjectTargetType("/source.ts", [{ ...field("read", callable), method: true }]);
  const contract = object(rustCallableTargetType([], scalar));
  const concrete = object(rustCallableTargetType([], scalar, { kind: "static" }));
  const selected = bindRustStructuralImplementationContract(concrete, contract);
  assert.equal(selected !== undefined, true, "an actual capture-free native method completes its placeholder contract");
  assert.equal(rustTargetTypeRefEquals(selected, concrete), true, "the exact physical implementation is preserved");
  assert.equal(rustCallableProtocol(rustStructuralObjectCarrierValue(contract).fields[0].type).lifetime.kind, "placeholder",
    "logical checked method metadata is never rewritten by physical completion");
  const borrowed = { kind: "parameter", identity: "actual-native-capture", name: "capture" };
  const captured = object(rustCallableTargetType([], scalar, borrowed));
  const selectedBorrow = bindRustStructuralImplementationContract(captured, contract);
  assert.equal(selectedBorrow !== undefined && rustTargetTypeRefEquals(selectedBorrow, captured), true,
    "a real borrowed native lifetime retains its exact identity rather than becoming static");
  const explicit = object(rustCallableTargetType([], scalar, { kind: "parameter", identity: "other-owner", name: "other" }));
  assert.equal(bindRustStructuralImplementationContract(concrete, explicit) === undefined, true,
    "an authored non-placeholder native lifetime is not relaxed to force compatibility");
  assert.equal(bindRustStructuralImplementationContract(concrete, object(rustCallableTargetType([scalar], scalar))) === undefined, true,
    "lifetime completion never relaxes the exact native parameter geometry");
});

function registeredShape(selected, sourceType, sourceAlias) {
  return { sourceType, ...(sourceAlias === undefined ? {} : { sourceAlias }), carrier: selected, storage: "structural-object",
    fields: rustStructuralObjectCarrierValue(selected).fields.map((entry, storageIndex) => ({ ...entry,
      declarations: [], symbols: [], sourceType, resultCarrier: entry.type, storageIndex })) };
}

test("structural registration requires the actual relation instead of accepting the superseded template argument", () => {
  const registry = createRustSourceTypeRegistry();
  const shape = registeredShape(carrier([scalar]), {});
  for (const registration of [undefined, null, shape.carrier, { kind: "generic-instantiation" },
    { kind: "unqualified", template: shape.carrier }]) {
    assert.equal(registry.registerStructuralObject(shape, registration), false, "malformed or superseded registration is rejected");
    assert.equal(registry.structuralObjects().length, 0, "rejection publishes no partial shape");
  }
  assert.equal(registry.registerStructuralObject(shape, { kind: "root" }), true);
  assert.equal(registry.structuralInstantiations().length, 0, "an actual root invents no generic edge");
});

test("late alias registration cannot turn an explicitly independent root into a generic instance", () => {
  for (const aliasFirst of [true, false]) {
    const registry = createRustSourceTypeRegistry();
    const declaration = {};
    const template = carrier([parameter]);
    const independent = carrier([scalar]);
    assert.equal(registry.registerStructuralObject(registeredShape(template, {}, declaration), { kind: "root" }), true);
    if (aliasFirst) assert.equal(registry.registerRepresentationAlias(declaration, template), true);
    assert.equal(registry.registerStructuralObject(registeredShape(independent, {}, declaration), { kind: "root" }), true);
    assert.equal(registry.registerRepresentationAlias(declaration, template), true);
    assert.equal(registry.structuralInstantiations().length, 0, "only an actual generic producer may publish a generic edge");
    const plan = createRustStructuralShapePlan(registry.structuralObjects(), [], () => "source", [], new Map(), registry.structuralInstantiations());
    assert.equal(plan.definitions.length, 2, "the registry preserves the actual independent physical roots");
    assert.equal(plan.sharesStorage(template, independent), false);
  }
});

test("declaring a generic relation never weakens exact native geometry and generic correspondence", () => {
  const original = carrier([parameter]);
  const incompatible = rustStructuralObjectTargetType("/source.ts", [{ ...field("field0", scalar), readonly: true }]);
  const registry = createRustSourceTypeRegistry();
  assert.equal(registry.registerStructuralObject(registeredShape(original, {}), { kind: "root" }), true);
  assert.equal(registry.registerStructuralObject(registeredShape(incompatible, {}),
    { kind: "generic-instantiation", template: original }), true);
  assert.throws(() => createRustStructuralShapePlan(registry.structuralObjects(), [], () => "source", [], new Map(), registry.structuralInstantiations()),
    /exact generic-parameter correspondence/u, "a producer cannot use a generic tag to bypass mismatched native field contracts");
});

test("physical instances do not replace or ambiguate the checked logical type template", () => {
  const sourceType = {};
  const registry = createRustSourceTypeRegistry();
  const template = carrier([parameter]);
  const instance = carrier([scalar]);
  const shape = selectedCarrier => ({ sourceType, carrier: selectedCarrier, storage: "structural-object",
    fields: rustStructuralObjectCarrierValue(selectedCarrier).fields.map((entry, storageIndex) => ({
      ...entry, declarations: [], symbols: [], sourceType: {}, resultCarrier: entry.type, storageIndex,
    })) });
  assert.equal(registry.registerStructuralObject(shape(template), { kind: "root" }), true);
  assert.equal(registry.registerStructuralObject(shape(instance), { kind: "generic-instantiation", template }), true);
  assert.equal(registry.registerStructuralObject(shape(instance), { kind: "generic-instantiation", template }), true);
  assert.equal(rustTargetTypeRefEquals(registry.structuralObjectForType(sourceType).carrier, template), true);
  assert.equal(rustTargetTypeRefEquals(registry.structuralObjectForType(sourceType, instance).carrier, instance), true);
  assert.equal(registry.structuralObjectForType({}, instance), undefined);
  assert.equal(registry.structuralInstantiations().length, 1);
  assert.equal(registry.registerStructuralObject(shape(carrier([{ kind: "source-primitive", name: "uint32" }])), { kind: "root" }), true);
  assert.equal(registry.structuralObjectForType(sourceType), undefined);
});

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
    assert.equal(registry.registerStructuralObject(shape(root, declaration), { kind: "root" }), true);
    if (aliasFirst) assert.equal(registry.registerRepresentationAlias(declaration, root), true);
    const partial = shape(middle, declaration);
    assert.equal(registry.registerStructuralObject(partial, { kind: "generic-instantiation", template: root }), true);
    assert.equal(registry.registerStructuralObject(partial, { kind: "generic-instantiation", template: root }), true);
    assert.equal(registry.registerStructuralObject(shape(selected, otherDeclaration), { kind: "generic-instantiation", template: middle }), true);
    if (!aliasFirst) assert.equal(registry.registerRepresentationAlias(declaration, root), true);
    assert.equal(registry.registerRepresentationAlias(declaration, root), true);
    assert.equal(registry.structuralInstantiations().length, 2);
    assert.equal(registry.registerRepresentationAlias(declaration, selected), false);
    assert.equal(registry.structuralInstantiations().length, 2);
    const plan = createRustStructuralShapePlan(registry.structuralObjects(), [], () => "source", [], new Map(),
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
    carrier: root, storage: "structural-object", fields: [] }, { kind: "root" }), true);
  assert.equal(registry.registerStructuralObject({ sourceType: {}, sourceAlias: otherDeclaration,
    carrier: selected, storage: "structural-object", fields: [] }, { kind: "root" }), true);
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
    storage: "structural-object", fields }, { kind: "root" }), true);
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
  const context = { ast: { kindName: () => "KindPropertySignature", typeNode: () => undefined,
    is: { IsMethodDeclaration: () => false } },
    currentSemantics: { types: { aliasApplication: () => undefined, structuralMembers(source, destination, purpose) {
    assert.equal(source, selectedType);
    assert.equal(destination, templateType);
    assert.equal(purpose, "correspondence", "generic member correspondence does not authorize a physical read");
    return correspondence;
  } } } };
  return { sourceTypes, templateCarrier, selectedCarrier, templateType, selectedType, declarations, selectedSymbols,
    correspondence, context, retain() {
      return retainRustStructuralInstantiation(selectedType, templateCarrier, selectedCarrier, context, { sourceTypes });
    } };
}

test("structural storage parameterizes independent family outputs without reversing their source argument", () => {
  const template = carrier([projection("Storage"), projection("Container"), projection("Storage"),
    { kind: "type-parameter", identity: "Storage0", name: "Storage0" }]);
  const fields = rustStructuralObjectCarrierValue(rustStructuralGenericCarrier(template, "fields").carrier).fields;
  assert.deepEqual(fields.map(entry => entry.type.name), ["Storage1", "Storage2", "Storage1", "Storage0"]);
  assert.deepEqual(rustStructuralGenericCarrier(carrier([scalar]), "fields").carrier, carrier([scalar]));
});

test("native dispatch shares only implicit method receiver storage, never callable fields or authored lifetimes", () => {
  const borrowed = { kind: "parameter", identity: "actual:borrowed", name: "borrowed" };
  const callable = rustCallableTargetType([], scalar);
  const explicit = rustCallableTargetType([], scalar, borrowed);
  const nested = rustCallableTargetType([], explicit);
  const method = (name, type) => ({ ...field(name, type), method: true });
  const source = rustStructuralObjectTargetType("/source.ts", [
    method("first", callable), method("second", callable), field("stored", callable),
    method("explicit", explicit), method("nested", nested),
  ]);
  const fields = storage => rustStructuralObjectCarrierValue(rustStructuralGenericCarrier(source, storage).carrier).fields;
  const protocols = storage => new Map(fields(storage).map(value => [value.sourceName, rustCallableProtocol(value.type)]));
  const dispatch = protocols("dispatch");
  const stored = protocols("fields");
  assert.equal(rustLifetimesEqual(dispatch.get("first").lifetime, dispatch.get("second").lifetime), true,
    "both native methods retain the same actual erased receiver environment");
  assert.equal(rustLifetimesEqual(dispatch.get("first").lifetime, dispatch.get("nested").lifetime), true,
    "a result callable does not create an independent lifetime for the shared receiver");
  assert.equal(rustLifetimesEqual(dispatch.get("first").lifetime, dispatch.get("stored").lifetime), false,
    "a callable data field keeps its separate stored-value lifetime even with the identical source callable type");
  assert.equal(rustLifetimesEqual(dispatch.get("explicit").lifetime, borrowed), true, "an authored native lifetime retains its exact identity");
  assert.equal(rustLifetimesEqual(rustCallableProtocol(dispatch.get("nested").result).lifetime, borrowed), true,
    "a genuine returned callable lifetime stays in the native method ABI");
  assert.equal(rustLifetimesEqual(stored.get("first").lifetime, stored.get("second").lifetime), false,
    "ordinary fields keep their independently captured callable environments");
  const original = rustStructuralObjectCarrierValue(source).fields.find(value => value.sourceName === "first");
  assert.equal(rustCallableProtocol(original.type).lifetime.kind, "placeholder", "native storage selection never rewrites the logical checked contract");
});

test("nested structural family storage retains exact child definitions and independent argument positions", () => {
  const inner = carrier([projection("Storage"), projection("Container")]);
  const outer = carrier([projection("Container"), inner]);
  const plan = createRustStructuralShapePlan([{ carrier: inner }, { carrier: outer }], [], () => "source", [], new Map());
  const outerDefinition = plan.definitionForCarrier(outer);
  const canonical = plan.definitions.find(definition => definition.targetName === outerDefinition.targetName);
  const child = plan.definitionForCarrier(canonical.fields[1].carrier);
  assert.equal(plan.definitions.length, 2);
  assert.equal(child.targetName, plan.definitionForCarrier(inner).targetName);
  assert.deepEqual(child.genericArguments.map(argument => argument.type.name), ["Storage1", "Storage0"]);
  assert.deepEqual(child.fields.map(field => field.carrier.name), ["Storage1", "Storage0"]);
  assert.throws(() => createRustStructuralShapePlan([{ carrier: outer }], [], () => "source", [], new Map()),
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
  const plan = createRustStructuralShapePlan(input.sourceTypes.structuralObjects(), [], () => "source", [], new Map(),
    input.sourceTypes.structuralInstantiations());
  assert.equal(plan.definitions.length, 1);
  assert.equal(plan.definitions[0].genericParameters.length, 2);
  assert.deepEqual(plan.definitionForCarrier(plan.definitions[0].carrier), plan.definitions[0]);
  assert.deepEqual(plan.definitionForCarrier(plan.definitions[0].carrier).genericArguments.map(argument => argument.type),
    ["Storage", "Container"].map((name, index) => ({ kind: "type-parameter",
      identity: `structural-storage:${closedMetadataKey(projection(name))}`, name: `Storage${index}` })));
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
    structuralMembers(_source, _destination, purpose) {
      assert.equal(purpose, "correspondence", "rejected source identity still uses the exact correspondence question");
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

import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeFamilyRegistry } from "../../../dist/analysis/project-types/type-families.js";
import { createRustAssociatedRequirementCollector } from "../../../dist/analysis/declarations/associated-requirements.js";
import { analyzeRustShapeGenericRequirements } from "../../../dist/analysis/declarations/generic-shape-requirements.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCarrierSupportsTrait } from "../../../dist/target-model/types/carriers/traits.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";
import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../../../dist/policy/types/type-family-normalization.js";
import { rustTypeFromCarrier } from "../../../dist/backend/planner/types/render.js";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { rustIndexedFieldKey, rustIndexedFieldProjection, rustIndexedFieldTrait } from "../../../dist/target-model/types/carriers/indexed-fields.js";

const signed = { kind: "source-primitive", name: "int32" };
const unsigned = { kind: "source-primitive", name: "uint32" };
const parameter = { kind: "type-parameter", name: "T" };
const family = {
  kind: "conditional",
  declaration: {}, parameter: {},
  trait: { kind: "trait-ref", id: "storage-identity", path: "Storage",
    sourceItem: { fileName: "/storage.ts", typeName: "Storage" },
    genericArguments: [], associatedConstraints: [] },
};
const projection = { kind: "associated-type", owner: parameter, trait: family.trait, name: "Output" };

test("source family optional reads retain a later Clone obligation without admitting native unknown associated types", () => {
  const selected = selectRustFlowReadProjection(rustOptionTargetType(projection), projection, {});
  assert.equal(selected.kind, "projection");
  assert.equal(selected.fact.kind, "option-value");
  assert.deepEqual(selected.fact.selectedCarrier, projection);
  const native = { ...projection, trait: { ...family.trait, sourceItem: undefined } };
  assert.equal(selectRustFlowReadProjection(rustOptionTargetType(native), native, {}).kind, "incompatible");
});

test("dependent type families retain exact identity and reject conflicting output revisions", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  assert.equal(registry.register(family), true);
  assert.equal(registry.register({ ...family, declaration: {} }), false);
  assert.equal(registry.register({ ...family, trait: { ...family.trait, sourceItem: undefined } }), false);
  const implementation = { family, arguments: [], owner: signed, output: unsigned, sourceFileName: "/storage.ts" };
  assert.equal(registry.registerImplementation(implementation), true);
  assert.equal(registry.registerImplementation({ ...implementation, output: signed }), false);
  assert.deepEqual(registry.implementation(family.trait, signed).output, unsigned);
  assert.equal(registry.implementation({ ...family.trait, id: "different-family" }, signed), undefined);
});

test("type family publication snapshots target carriers and prohibits late writes", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  const mutable = { ...signed };
  assert.equal(registry.registerImplementation({ family, arguments: [], owner: mutable, output: mutable, sourceFileName: "/storage.ts" }), true);
  mutable.name = "uint32";
  const sealed = registry.seal();
  assert.equal(sealed.implementations[0].output.name, "int32");
  assert.deepEqual(sealed.normalize({ ...projection, owner: signed }), signed);
  const unselected = { ...projection, owner: unsigned };
  assert.equal(sealed.normalize(unselected), unselected);
  assert.equal(Object.isFrozen(sealed.implementations[0].output), true);
  assert.throws(() => registry.register(family), /already sealed/u);
  assert.throws(() => registry.registerImplementation(sealed.implementations[0]), /already sealed/u);
});

test("generic family implementations preserve native argument widths on every use", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  const owner = (type) => rustSourceTypeCarrier("/value.ts", "Value", "object", [{ kind: "type", type }]);
  registry.registerImplementation({ family, arguments: [], owner: owner(parameter), output: { kind: "tuple", elements: [parameter] }, sourceFileName: "/value.ts" });
  assert.deepEqual(registry.implementation(family.trait, owner(unsigned)).output, { kind: "tuple", elements: [unsigned] });
  const unresolved = { ...projection, owner: owner(parameter) };
  const concrete = substituteRustTargetGenerics(unresolved, new Map([["T", signed]]), new Map(), new Map(), rustTypeFamilyNormalizer(registry));
  assert.deepEqual(concrete, { kind: "tuple", elements: [signed] });
  assert.equal(registry.registerImplementation({ family, arguments: [], owner: signed, output: parameter, sourceFileName: "/storage.ts" }), false);
});

test("type family templates replace equivalent concrete demands without overlapping impls", () => {
  for (const genericFirst of [false, true]) {
    const registry = createRustSourceTypeFamilyRegistry();
    registry.register(family);
    const owner = type => rustSourceTypeCarrier("/value.ts", "Value", "object", [{ kind: "type", type }]);
    const make = type => ({ family, arguments: [], owner: owner(type), output: type, sourceFileName: "/value.ts" });
    const requests = [make(signed), make(parameter)];
    if (genericFirst) requests.reverse();
    for (const request of requests) assert.equal(registry.registerImplementation(request), true);
    assert.equal(registry.implementations().length, 1);
    assert.deepEqual(registry.implementation(family.trait, owner(unsigned)).output, unsigned);
    assert.equal(registry.registerImplementation({ ...make(unsigned), output: signed }), false);
    assert.equal(registry.registerImplementation({ ...make(unsigned), sourceFileName: "/different.ts" }), false);
  }
});

test("a family rejects blanket and conflicting partially specialized implementations", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  assert.equal(registry.registerImplementation({ family, arguments: [], owner: parameter, output: parameter, sourceFileName: "/storage.ts" }), false);
  const owner = (left, right) => rustSourceTypeCarrier("/pair.ts", "Pair", "object",
    [{ kind: "type", type: left }, { kind: "type", type: right }]);
  assert.equal(registry.registerImplementation({ family, arguments: [], owner: owner(parameter, signed), output: signed, sourceFileName: "/pair.ts" }), true);
  assert.equal(registry.registerImplementation({ family, arguments: [], owner: owner(unsigned, parameter), output: unsigned, sourceFileName: "/pair.ts" }), false);
});

test("source trait references require source-owned paths rather than native-path guessing", () => {
  assert.equal(isRustTargetTypeRef(family.trait), true);
  assert.equal(isRustTargetTypeRef({ ...family.trait, path: "other" }), false);
  assert.equal(rustTypeFromCarrier(projection), undefined);
  assert.deepEqual(rustTypeFromCarrier(projection, (source) => {
    assert.deepEqual(source, family.trait.sourceItem);
    return "crate::storage::Storage";
  }), { kind: "qualified", owner: { kind: "named", path: "T" },
    trait: { kind: "named", path: "crate::storage::Storage" }, member: "Output" });
  assert.equal(rustTargetTypeRefEquals(family.trait, {
    ...family.trait, sourceItem: { ...family.trait.sourceItem, fileName: "/other.ts" },
  }), false);
});

test("associated-output obligations are distinct from input Clone and propagate through tuples", () => {
  assert.equal(rustCarrierSupportsTrait(projection, "core::clone::Clone", () => true), false);
  assert.equal(rustCarrierSupportsTrait({ kind: "tuple", elements: [projection] }, "core::clone::Clone", () => false,
    (carrier, trait) => rustTargetTypeRefEquals(carrier, projection) && trait === "core::clone::Clone"), true);
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  const collector = createRustAssociatedRequirementCollector(new Set(["T"]), registry, () => false);
  assert.equal(collector.collect(projection), true);
  assert.equal(collector.require(projection, "clone"), true);
  assert.deepEqual(collector.seal(), [{ carrier: projection, requirements: ["clone"] }]);
  assert.equal(collector.require({ ...projection, owner: { kind: "type-parameter", name: "Unbound" } }, "clone"), false);
});

test("normalization uses proved implementations and rejects recursive output equations", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  const normalizer = rustTypeFamilyNormalizer(registry);
  assert.deepEqual(mapRustTargetTypes(projection, normalizer), projection);
  const closed = { ...projection, owner: signed };
  registry.registerImplementation({ family, arguments: [], owner: signed, output: closed, sourceFileName: "/storage.ts" });
  assert.throws(() => mapRustTargetTypes(closed, normalizer), /recursive native output equation/u);
});

test("structural shapes retain the independent requirements of nested generic records", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  const declaration = {};
  const record = rustSourceTypeCarrier("/holder.ts", "Holder", "object", [{ kind: "type", type: parameter }]);
  const definition = { declaration, genericParameters: [{ kind: "type", targetName: "T" }] };
  const policy = { definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, record) ? definition : undefined };
  const contract = { declaration, typeParameters: [{ name: "T", requirements: ["clone"] }],
    associatedTypes: [{ carrier: projection, requirements: ["default"] }] };
  const shape = { kind: "tuple", elements: [record] };
  const selected = analyzeRustShapeGenericRequirements(shape, policy, registry, owner => owner === declaration ? contract : undefined);
  assert.deepEqual(selected.typeParameters, [{ name: "T", requirements: ["clone"] }]);
  assert.deepEqual(selected.associatedTypes, [{ carrier: projection, requirements: ["default"] }]);
  assert.equal(analyzeRustShapeGenericRequirements(shape, policy, registry, () => undefined), undefined);
});

test("nongeneric shapes acquire no speculative generic bounds", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  const selected = analyzeRustShapeGenericRequirements({ kind: "tuple", elements: [signed, unsigned] },
    { definitionForCarrier: () => undefined }, registry, () => undefined);
  assert.deepEqual(selected, { typeParameters: [], associatedTypes: [] });
});

test("indexed families distinguish exact keys and retain readonly storage and independent obligations", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  const indexed = { kind: "indexed", trait: rustIndexedFieldTrait };
  const countKey = rustIndexedFieldKey("00000000000000000000000000000001");
  const labelKey = rustIndexedFieldKey("00000000000000000000000000000002");
  const owner = rustSourceTypeCarrier("/record.ts", "Record", "object", []);
  assert.equal(registry.register(indexed), true);
  assert.equal(registry.register({ ...indexed, trait: { ...rustIndexedFieldTrait, path: "unproved::Field" } }), false);
  for (const [index, key, output, readonly] of [[0, countKey, signed, false], [1, labelKey, unsigned, true]]) {
    assert.equal(registry.registerImplementation({ family: indexed, arguments: [{ kind: "type", type: key }], owner,
      output, sourceFileName: "/record.ts", field: { storage: "structural-object", storageIndex: index, readonly, sharedWrite: !readonly } }), true);
  }
  assert.deepEqual(rustTypeFamilyNormalizer(registry)(rustIndexedFieldProjection(owner, countKey)), signed);
  assert.deepEqual(rustTypeFamilyNormalizer(registry)(rustIndexedFieldProjection(owner, labelKey)), unsigned);
  const open = rustIndexedFieldProjection(parameter, { kind: "type-parameter", name: "Key" });
  const collector = createRustAssociatedRequirementCollector(new Set(["T", "Key"]), registry, () => false);
  assert.equal(collector.requireField(open, ["read", "write"]), true);
  assert.equal(collector.requireField(rustIndexedFieldProjection(owner, labelKey), ["read"]), true);
  assert.equal(collector.requireField(rustIndexedFieldProjection(owner, labelKey), ["write"]), false);
  assert.deepEqual(collector.seal(), [{ carrier: open, requirements: [], fieldAccess: ["read", "write"] }]);
});

test("indexed field identity collisions and incomplete native implementations fail closed", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  const identity = "00000000000000000000000000000001";
  assert.equal(registry.registerFieldKey(identity, "count"), true);
  assert.equal(registry.registerFieldKey(identity, "count"), true);
  assert.equal(registry.registerFieldKey(identity, "label"), false);
  assert.equal(registry.registerFieldKey("invalid", "count"), false);
  const indexed = { kind: "indexed", trait: rustIndexedFieldTrait };
  registry.register(indexed);
  const implementation = { family: indexed, owner: signed, output: unsigned,
    arguments: [{ kind: "type", type: rustIndexedFieldKey(identity) }], sourceFileName: "/record.ts",
    field: { storage: "structural-object", storageIndex: 0, readonly: false, sharedWrite: true } };
  for (const mutation of [{ field: undefined }, { field: { ...implementation.field, storageIndex: -1 } },
    { field: { ...implementation.field, sharedWrite: undefined } },
    { field: { ...implementation.field, readonly: true, sharedWrite: true } },
    { arguments: [] }, { arguments: [{ kind: "type", type: parameter }] }]) {
    assert.equal(registry.registerImplementation({ ...implementation, ...mutation }), false);
  }
  registry.seal();
  assert.throws(() => registry.registerFieldKey(identity, "count"), /already sealed/u);
});

test("inline native field reads do not invent shared-write capability", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  const indexed = { kind: "indexed", trait: rustIndexedFieldTrait };
  const key = rustIndexedFieldKey("00000000000000000000000000000001");
  registry.register(indexed);
  assert.equal(registry.registerImplementation({ family: indexed, owner: signed, output: unsigned,
    arguments: [{ kind: "type", type: key }], sourceFileName: "/record.ts",
    field: { storage: "structural-object", storageIndex: 0, readonly: false, sharedWrite: false } }), true);
  const collector = createRustAssociatedRequirementCollector(new Set(), registry, () => false);
  const projection = rustIndexedFieldProjection(signed, key);
  assert.equal(collector.requireField(projection, ["read"]), true);
  assert.equal(collector.requireField(projection, ["write"]), false);
});

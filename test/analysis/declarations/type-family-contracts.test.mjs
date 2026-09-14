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

const signed = { kind: "source-primitive", name: "int32" };
const unsigned = { kind: "source-primitive", name: "uint32" };
const parameter = { kind: "type-parameter", name: "T" };
const family = {
  declaration: {}, parameter: {},
  trait: { kind: "trait-ref", id: "storage-identity", path: "Storage",
    sourceItem: { fileName: "/storage.ts", typeName: "Storage" },
    genericArguments: [], associatedConstraints: [] },
};
const projection = { kind: "associated-type", owner: parameter, trait: family.trait, name: "Output" };

test("dependent type families retain exact identity and reject conflicting output revisions", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  assert.equal(registry.register(family), true);
  assert.equal(registry.register({ ...family, declaration: {} }), false);
  assert.equal(registry.register({ ...family, trait: { ...family.trait, sourceItem: undefined } }), false);
  const implementation = { family, owner: signed, output: unsigned, sourceFileName: "/storage.ts" };
  assert.equal(registry.registerImplementation(implementation), true);
  assert.equal(registry.registerImplementation({ ...implementation, output: signed }), false);
  assert.deepEqual(registry.implementation(family.trait.id, signed).output, unsigned);
  assert.equal(registry.implementation("different-family", signed), undefined);
});

test("type family publication snapshots target carriers and prohibits late writes", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  const mutable = { ...signed };
  assert.equal(registry.registerImplementation({ family, owner: mutable, output: mutable, sourceFileName: "/storage.ts" }), true);
  mutable.name = "uint32";
  const sealed = registry.seal();
  assert.equal(sealed.implementations[0].output.name, "int32");
  assert.equal(Object.isFrozen(sealed.implementations[0].output), true);
  assert.throws(() => registry.register(family), /already sealed/u);
  assert.throws(() => registry.registerImplementation(sealed.implementations[0]), /already sealed/u);
});

test("generic family implementations preserve native argument widths on every use", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  const owner = (type) => rustSourceTypeCarrier("/value.ts", "Value", "object", [{ kind: "type", type }]);
  registry.registerImplementation({ family, owner: owner(parameter), output: { kind: "tuple", elements: [parameter] }, sourceFileName: "/value.ts" });
  assert.deepEqual(registry.implementation(family.trait.id, owner(unsigned)).output, { kind: "tuple", elements: [unsigned] });
  const unresolved = { ...projection, owner: owner(parameter) };
  const concrete = substituteRustTargetGenerics(unresolved, new Map([["T", signed]]), new Map(), new Map(), rustTypeFamilyNormalizer(registry));
  assert.deepEqual(concrete, { kind: "tuple", elements: [signed] });
  assert.equal(registry.registerImplementation({ family, owner: signed, output: parameter, sourceFileName: "/storage.ts" }), false);
});

test("type family templates replace equivalent concrete demands without overlapping impls", () => {
  for (const genericFirst of [false, true]) {
    const registry = createRustSourceTypeFamilyRegistry();
    registry.register(family);
    const owner = type => rustSourceTypeCarrier("/value.ts", "Value", "object", [{ kind: "type", type }]);
    const make = type => ({ family, owner: owner(type), output: type, sourceFileName: "/value.ts" });
    const requests = [make(signed), make(parameter)];
    if (genericFirst) requests.reverse();
    for (const request of requests) assert.equal(registry.registerImplementation(request), true);
    assert.equal(registry.implementations().length, 1);
    assert.deepEqual(registry.implementation(family.trait.id, owner(unsigned)).output, unsigned);
    assert.equal(registry.registerImplementation({ ...make(unsigned), output: signed }), false);
    assert.equal(registry.registerImplementation({ ...make(unsigned), sourceFileName: "/different.ts" }), false);
  }
});

test("a family rejects blanket and conflicting partially specialized implementations", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  assert.equal(registry.registerImplementation({ family, owner: parameter, output: parameter, sourceFileName: "/storage.ts" }), false);
  const owner = (left, right) => rustSourceTypeCarrier("/pair.ts", "Pair", "object",
    [{ kind: "type", type: left }, { kind: "type", type: right }]);
  assert.equal(registry.registerImplementation({ family, owner: owner(parameter, signed), output: signed, sourceFileName: "/pair.ts" }), true);
  assert.equal(registry.registerImplementation({ family, owner: owner(unsigned, parameter), output: unsigned, sourceFileName: "/pair.ts" }), false);
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
  registry.registerImplementation({ family, owner: signed, output: closed, sourceFileName: "/storage.ts" });
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

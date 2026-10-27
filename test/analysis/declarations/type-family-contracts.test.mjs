import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeFamilyRegistry } from "../../../dist/analysis/project-types/type-families.js";
import { createRustAssociatedRequirementCollector } from "../../../dist/analysis/declarations/associated-requirements.js";
import { analyzeRustShapeGenericRequirements } from "../../../dist/analysis/declarations/generic-shape-requirements.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCarrierSupportsTrait } from "../../../dist/policy/constraints/native-traits.js";
import { rustSourceTypeCarrier, rustSourceUnionTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../../../dist/analysis/project-types/type-family-normalization.js";
import { rustTypeFromCarrier } from "../../../dist/backend/planner/types/carrier-syntax.js";
import { selectRustFlowReadProjection } from "../../../dist/policy/conversions/value-carrier-reconciliation.js";
import { rustOptionTargetType, rustSourceLocationTargetType } from "../../../dist/target-model/types/index.js";
import { rustIndexedFieldKey, rustIndexedFieldProjection, rustIndexedFieldTrait } from "../../../dist/target-model/types/carriers/indexed-fields.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { createRustNativeCallableProtocolRegistry } from "../../../dist/analysis/callables/native-protocols.js";
import { rustNativeCallableErrorChannel, rustNativeCallableErrorType } from "../../../dist/policy/types/callables/native-protocols.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustFutureTargetType } from "../../../dist/target-model/types/carriers/primitives.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { analyzeRustSourcePackageComponents } from "../../../dist/analysis/source-modules/component-semantics.js";
import { rustProgramErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";

const signed = { kind: "source-primitive", name: "int32" };
const unsigned = { kind: "source-primitive", name: "uint32" };
const parameter = { kind: "type-parameter", identity: "T", name: "T" };
const family = {
  kind: "conditional",
  declaration: {}, parameter: {},
  trait: { kind: "trait-ref", id: "storage-identity", path: "Storage",
    sourceItem: { fileName: "/storage.ts", typeName: "Storage" },
    genericArguments: [], associatedConstraints: [] },
};
const projection = { kind: "associated-type", owner: parameter, trait: family.trait, name: "Output" };

let checkedErrorBoundary;
function errorBoundaryFixture() {
  if (checkedErrorBoundary !== undefined) return checkedErrorBoundary;
  const context = analyzeRustErrorEffects(`
    class AppError extends Error {}
    export function fail(): never { throw new AppError("shape boundary"); }
  `);
  const components = analyzeRustSourcePackageComponents(context, "lib", node => context.records.errorEffects.get(node));
  assert.equal(components.kind, "resolved", "the fixture has its actual completed source error component");
  const scope = context.sourceFiles[0];
  assert.equal(scope !== undefined, true, "the fixture has an exact checked source scope");
  checkedErrorBoundary = { scope, input: { ast: context.ast, records: context.records,
    definitions: context.typeDefinitions, producers: context.callableValues.nativeProducers, components: components.plan } };
  return checkedErrorBoundary;
}

test("optional carrier selection records the exact payload independently of move or clone demand", () => {
  const native = { ...projection, trait: { ...family.trait, sourceItem: undefined } };
  for (const carrier of [projection, native]) {
    const selected = selectRustFlowReadProjection(rustOptionTargetType(carrier), carrier, {});
    assert.equal(selected.kind, "projection");
    assert.equal(selected.fact.kind, "option-value");
    assert.deepEqual(selected.fact.selectedCarrier, carrier);
    assert.equal(rustCarrierSupportsTrait(carrier, "core::clone::Clone"), false);
  }
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

test("optional storage normalizes exact selected family outputs without inventing closed generic parameters", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  registry.registerImplementation({ family, arguments: [], owner: signed, output: unsigned, sourceFileName: "/storage.ts" });
  const storage = rustSourceOptionalTargetType(projection);
  const normalize = rustTypeFamilyNormalizer(registry);
  assert.deepEqual(substituteRustTargetGenerics(storage, new Map([["T", signed]]), new Map(), new Map(), normalize),
    rustSourceOptionalTargetType(unsigned));
  assert.deepEqual(mapRustTargetTypes(storage, normalize), storage);
  const foreign = { ...projection, trait: { ...family.trait, id: "foreign" } };
  assert.deepEqual(mapRustTargetTypes(rustSourceOptionalTargetType(foreign), normalize), rustSourceOptionalTargetType(foreign));
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

test("type families retain disjoint nested nominal templates and subsume only their own concrete demands", () => {
  const owner = (name, type) => rustOptionTargetType(rustSourceLocationTargetType(
    rustSourceTypeCarrier("/cache.ts", name, "object", [{ kind: "type", type }])));
  const make = (name, type) => ({ family, arguments: [], owner: owner(name, type), output: owner(name, type), sourceFileName: "/storage.ts" });
  for (const genericFirst of [false, true]) {
    for (const names of [["Entry", "OtherEntry", "LastEntry"], ["LastEntry", "OtherEntry", "Entry"]]) {
      const registry = createRustSourceTypeFamilyRegistry();
      assert.equal(registry.register(family), true);
      const requests = names.flatMap(name => [make(name, signed), make(name, parameter)]);
      if (genericFirst) requests.reverse();
      for (const request of requests) assert.equal(registry.registerImplementation(request), true);
      assert.equal(registry.implementations().length, 3);
      for (const name of names) {
        assert.deepEqual(registry.implementation(family.trait, owner(name, unsigned)).output, owner(name, unsigned));
        const renamed = { kind: "type-parameter", identity: "Renamed", name: "Renamed" };
        assert.equal(registry.registerImplementation(make(name, renamed)), true);
        assert.equal(registry.registerImplementation({ ...make(name, unsigned), output: signed }), false);
        assert.equal(registry.registerImplementation({ ...make(name, unsigned), sourceFileName: "/foreign.ts" }), false);
      }
      const before = registry.implementations();
      const broad = rustOptionTargetType(rustSourceLocationTargetType(parameter));
      assert.equal(registry.registerImplementation({ family, arguments: [], owner: broad, output: signed, sourceFileName: "/storage.ts" }), false);
      assert.deepEqual(registry.implementations(), before);
      const sealed = registry.seal();
      for (const name of names) assert.deepEqual(sealed.normalize({ ...projection, owner: owner(name, unsigned) }), owner(name, unsigned));
      assert.equal(sealed.implementations.length, 3);
    }
  }
});

test("substituting a compound argument normalizes nested selected families without recursively substituting binders", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  registry.registerImplementation({ family, arguments: [], owner: signed, output: unsigned, sourceFileName: "/storage.ts" });
  const nested = { kind: "tuple", elements: [{ ...projection, owner: signed }, parameter] };
  const result = substituteRustTargetGenerics(parameter, new Map([["T", nested]]), new Map(), new Map(),
    rustTypeFamilyNormalizer(registry));
  assert.deepEqual(result, { kind: "tuple", elements: [unsigned, parameter] });
  assert.deepEqual(substituteRustTargetGenerics(parameter, new Map([["T", nested]])), nested);
  const unselected = { kind: "tuple", elements: [{ ...projection, owner: unsigned }] };
  assert.deepEqual(substituteRustTargetGenerics(parameter, new Map([["T", unselected]]), new Map(), new Map(),
    rustTypeFamilyNormalizer(registry)), unselected);
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
  assert.deepEqual(rustTypeFromCarrier(projection, { pathFor: (source) => {
    assert.deepEqual(source, family.trait.sourceItem);
    return "crate::storage::Storage";
  }, additionalArgumentsFor: () => [] }), { kind: "qualified", owner: { kind: "named", path: "T" },
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
  const collector = createRustAssociatedRequirementCollector(new Set(["T"]), registry, () => false, () => false);
  assert.equal(collector.collect(projection), true);
  assert.equal(collector.require(projection, "clone"), true);
  assert.deepEqual(collector.seal(), [{ carrier: projection, requirements: ["clone"] }]);
  assert.equal(collector.require({ ...projection, owner: { kind: "type-parameter", identity: "Unbound", name: "Unbound" } }, "clone"), false);
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
  const boundary = errorBoundaryFixture();
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register(family);
  const declaration = {};
  const record = rustSourceTypeCarrier("/holder.ts", "Holder", "object", [{ kind: "type", type: parameter }]);
  const definition = { declaration, genericParameters: [{ kind: "type", identity: "T", targetName: "T" }] };
  const policy = { definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, record) ? definition : undefined };
  const contract = { declaration, typeParameters: [{ identity: "T", name: "T", requirements: ["clone"] }],
    associatedTypes: [{ carrier: projection, requirements: ["default"] }] };
  const shape = { kind: "tuple", elements: [record] };
  const selected = analyzeRustShapeGenericRequirements(shape, policy, registry, owner => owner === declaration ? contract : undefined,
    undefined, emptyRustTypeDefinitions, [], boundary.input, boundary.scope);
  assert.deepEqual(selected.typeParameters, [{ identity: "T", name: "T", requirements: ["clone"] }]);
  assert.deepEqual(selected.associatedTypes, [{ carrier: projection, requirements: ["default"] }]);
  assert.equal(analyzeRustShapeGenericRequirements(shape, policy, registry, () => undefined, undefined,
    emptyRustTypeDefinitions, [], boundary.input, boundary.scope) === undefined, true, "the exact nested declaration contract is required");
});

test("nongeneric shapes acquire no speculative generic bounds", () => {
  const boundary = errorBoundaryFixture();
  const registry = createRustSourceTypeFamilyRegistry();
  const selected = analyzeRustShapeGenericRequirements({ kind: "tuple", elements: [signed, unsigned] },
    { definitionForCarrier: () => undefined }, registry, () => undefined, undefined,
    emptyRustTypeDefinitions, [], boundary.input, boundary.scope);
  assert.deepEqual(selected, { typeParameters: [], associatedTypes: [] });
});

test("nested generated sum instantiations retain independent payload requirements", () => {
  const boundary = errorBoundaryFixture();
  const registry = createRustSourceTypeFamilyRegistry();
  assert.equal(registry.register(family), true);
  const definitions = createRustTypeDefinitionRegistry();
  const union = payloads => rustSourceUnionTargetType("/nested.ts", "Union2",
    [], "generated", { kind: "physical", types: payloads });
  const definition = payloads => ({ carrier: union(payloads), variants: payloads.map((carrier, index) => ({
    name: `Variant${index}`, carrier,
  })) });
  assert.equal(definitions.registerSourceUnion(definition([signed, unsigned]), false), true);
  const inner = union([parameter, projection]);
  const outer = union([inner, signed]);
  const policy = { definitionForCarrier: () => undefined };
  const selected = analyzeRustShapeGenericRequirements(outer, policy, registry, () => undefined, undefined,
    definitions.seal(), [], boundary.input, boundary.scope);
  assert.deepEqual(selected, {
    typeParameters: [{ identity: "T", name: "T", requirements: [] }],
    associatedTypes: [{ carrier: projection, requirements: [] }],
  });
  assert.equal(analyzeRustShapeGenericRequirements(union([union([parameter, { ...projection, owner: unsigned }]), signed]),
    policy, registry, () => undefined, undefined, definitions.seal(), [], boundary.input, boundary.scope) === undefined, true,
    "a nested sum without its exact definition is refused");
  const invalidInner = union([parameter, { ...projection,
    owner: { kind: "type-parameter", identity: "Other", name: "Other" } }]);
  const invalidOuter = union([invalidInner, signed]);
  assert.equal(analyzeRustShapeGenericRequirements(invalidOuter, policy, registry, () => undefined, undefined,
    { sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, invalidInner) ? undefined :
      [{ name: "Variant0", carrier: invalidInner }, { name: "Variant1", carrier: signed }] }, [], boundary.input, boundary.scope) === undefined, true,
    "a nested sum with a foreign generic owner is refused");
});

test("authored recursive sums reject changing recursive instantiations and missing payload evidence", () => {
  const boundary = errorBoundaryFixture();
  const registry = createRustSourceTypeFamilyRegistry();
  const policy = { definitionForCarrier: () => undefined };
  const authored = type => rustSourceUnionTargetType("/nested.ts", "Recursive", [{ kind: "type", type }]);
  const initial = authored(signed);
  const changed = authored(unsigned);
  assert.equal(analyzeRustShapeGenericRequirements(initial, policy, registry, () => undefined, undefined,
    { sourceUnionVariants: () => [{ name: "Next", carrier: changed }] }, [], boundary.input, boundary.scope) === undefined, true,
    "changing recursive instantiation is refused");
  assert.equal(analyzeRustShapeGenericRequirements(initial, policy, registry, () => undefined, undefined,
    { sourceUnionVariants: () => undefined }, [], boundary.input, boundary.scope) === undefined, true,
    "missing recursive payload evidence is refused");
  assert.deepEqual(analyzeRustShapeGenericRequirements(initial, policy, registry, () => undefined, undefined,
    { sourceUnionVariants: () => [{ name: "Next", carrier: initial }] }, [], boundary.input, boundary.scope),
    { typeParameters: [], associatedTypes: [] });
});

test("nested shape static bounds materialize actual scoped errors without losing generic requirements", () => {
  const boundary = errorBoundaryFixture();
  const registry = createRustSourceTypeFamilyRegistry();
  const declaration = {};
  const payload = { kind: "tuple", elements: [parameter, rustProgramErrorTargetType()] };
  const record = rustSourceTypeCarrier("/holder.ts", "Holder", "object", [{ kind: "type", type: payload }]);
  const definition = { declaration, genericParameters: [{ kind: "type", identity: "Stored", targetName: "Stored" }] };
  const policy = { definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, record) ? definition : undefined };
  const contract = { declaration, typeParameters: [{ identity: "Stored", name: "Stored", requirements: ["static"] }],
    associatedTypes: [] };
  const selected = analyzeRustShapeGenericRequirements(record, policy, registry,
    owner => owner === declaration ? contract : undefined, undefined, emptyRustTypeDefinitions, [], boundary.input, boundary.scope);
  assert.equal(selected !== undefined, true, "the real checked project error boundary satisfies the nested static demand");
  assert.equal(selected.typeParameters.length, 1, "the complete generic payload remains quantified");
  assert.equal(selected.typeParameters[0].identity, "T", "the original generic owner is preserved");
  assert.equal(selected.typeParameters[0].requirements.includes("static"), true, "the generic static requirement is retained");
  assert.equal(analyzeRustShapeGenericRequirements(record, policy, registry,
    owner => owner === declaration ? contract : undefined, undefined, emptyRustTypeDefinitions, [], boundary.input, undefined) === undefined, true,
    "a logical error has no implicit ambient scope");
  const missing = { ...boundary.input, components: { ...boundary.input.components, componentForFile: () => undefined } };
  assert.equal(analyzeRustShapeGenericRequirements(record, policy, registry,
    owner => owner === declaration ? contract : undefined, undefined, emptyRustTypeDefinitions, [], missing, boundary.scope) === undefined, true,
    "a missing physical component is not a static guarantee");
});

test("shape static uses refuse foreign physical errors while non-static fields keep their original contract", () => {
  const boundary = errorBoundaryFixture();
  const registry = createRustSourceTypeFamilyRegistry();
  const policy = { definitionForCarrier: () => undefined };
  const logical = rustProgramErrorTargetType();
  const foreign = rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "foreign" });
  assert.equal(analyzeRustShapeGenericRequirements(logical, policy, registry, () => undefined, undefined,
    emptyRustTypeDefinitions, [], boundary.input, undefined) !== undefined, true,
    "an ordinary field does not acquire a speculative static demand");
  assert.equal(analyzeRustShapeGenericRequirements(foreign, policy, registry, () => undefined, undefined,
    emptyRustTypeDefinitions, [{ carrier: foreign, requirements: ["static"] }], boundary.input, boundary.scope) === undefined, true,
    "an unregistered physical owner never becomes static through a shape use");
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
  const open = rustIndexedFieldProjection(parameter, { kind: "type-parameter", identity: "Key", name: "Key" });
  const collector = createRustAssociatedRequirementCollector(new Set(["T", "Key"]), registry, () => false, () => false);
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
  const collector = createRustAssociatedRequirementCollector(new Set(), registry, () => false, () => false);
  const projection = rustIndexedFieldProjection(signed, key);
  assert.equal(collector.requireField(projection, ["read"]), true);
  assert.equal(collector.requireField(projection, ["write"]), false);
  assert.equal(collector.requireField(projection, ["read"], unsigned), true);
  assert.equal(collector.requireField(projection, ["read"], signed), false);
});

test("constrained field obligations preserve one exact native output equality", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  registry.register({ kind: "indexed", trait: rustIndexedFieldTrait });
  const identity = "00000000000000000000000000000001";
  const key = rustIndexedFieldKey(identity);
  assert.equal(registry.registerFieldKey(identity, "score"), true);
  assert.equal(registry.fieldKeyName(key), "score");
  assert.equal(registry.fieldKeyName(rustIndexedFieldKey("00000000000000000000000000000002")), undefined);
  assert.equal(registry.fieldKeyName({ ...key, id: "foreign-field-key" }), undefined);
  assert.equal(registry.fieldKeyName({ ...key, genericArguments: [{ kind: "const", value: { kind: "integer", value: "invalid" } }] }), undefined);
  assert.equal(registry.fieldKeyName({ ...key, genericArguments: [{ kind: "const", value: { kind: "integer", value: "340282366920938463463374607431768211456" } }] }), undefined);
  const projection = rustIndexedFieldProjection(parameter, key);
  const collector = createRustAssociatedRequirementCollector(new Set(["T"]), registry, () => true, () => false);
  assert.equal(collector.requireField(projection, ["read"], unsigned), true);
  assert.equal(collector.requireField(projection, ["read"], signed), false);
  assert.equal(collector.requireField(projection, ["read"], unsigned), true);
  const contract = collector.seal();
  assert.deepEqual(contract[0].output, unsigned);
  assert.deepEqual(contract[0].fieldAccess, ["read"]);
  assert.equal(Object.isFrozen(contract[0]), true);
});

test("native associated error obligations require exact callable evidence and declared parameter closure", () => {
  const protocols = createRustNativeCallableProtocolRegistry({ definitions: emptyRustTypeDefinitions, usedNames: new Set(),
    structuralShapes: { instantiateSourceCarrier() { assert.fail("this scalar family fixture has no structural output"); } } });
  const binding = protocols.bind("/source.ts", rustCallableTargetType([parameter], rustFutureTargetType(parameter)));
  const implementation = { kind: "type-parameter", identity: "source:Implementation", name: "Implementation" };
  const error = rustNativeCallableErrorType(binding, implementation, "invocation", []);
  const families = createRustSourceTypeFamilyRegistry();
  const proof = carrier => rustNativeCallableErrorChannel(binding, implementation, carrier) !== undefined;
  const collector = createRustAssociatedRequirementCollector(new Set(["T", implementation.identity]), families, () => false, proof);
  assert.equal(collector.collect({ kind: "tuple", elements: [error] }), true);
  assert.equal(collector.require(error, "js-rejection"), true);
  assert.deepEqual(collector.seal(), [{ carrier: error, requirements: ["js-rejection"] }]);
  assert.equal(collector.requireField(error, ["read"]), false);
  for (const invalid of [
    { ...error, owner: { ...implementation, identity: "foreign:Implementation" } },
    { ...error, trait: { ...error.trait, path: "Foreign" } },
    { ...error, trait: { ...error.trait, genericArguments: [{ kind: "type", type: unsigned }] } },
    { ...error, genericArguments: [{ kind: "type", type: parameter }] },
    { ...error, name: "AwaitError1" },
  ]) assert.equal(collector.require(invalid, "js-rejection"), false);
  const unbound = createRustAssociatedRequirementCollector(new Set([implementation.identity]), families, () => false, proof);
  assert.equal(unbound.require(error, "js-rejection"), false);
  const absent = createRustAssociatedRequirementCollector(new Set(["T", implementation.identity]), families, () => false, () => false);
  assert.equal(absent.require(error, "js-rejection"), false);
  const closedError = rustNativeCallableErrorType(binding, signed, "invocation", []);
  const concrete = createRustAssociatedRequirementCollector(new Set(["T"]), families, () => false,
    carrier => rustNativeCallableErrorChannel(binding, signed, carrier) !== undefined);
  assert.equal(concrete.require(closedError, "js-rejection"), false);
});

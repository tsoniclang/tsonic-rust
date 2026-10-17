import assert from "node:assert/strict";
import test from "node:test";
import { projectRustCompilerModule } from "../../../../dist/providers/native/projection/declarations.js";
import { rustCompilerProviderProtocolVersion } from "../../../../dist/providers/native/model/model.js";
import { selectRustCompilerResultLoans } from "../../../../dist/providers/native/model/normalization/functions.js";
import { targetTypeFor } from "../../../../dist/providers/native/projection/types.js";
import { compilerTargetTypeId } from "../../../../dist/providers/native/projection/operations.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../../dist/target-model/types/index.js";

const dependency = { alias: "example", packageId: "example 1", packageName: "example", packageVersion: "1",
  crateName: "example", targetCrateName: "example", manifestPath: "/example/Cargo.toml",
  sourceRoot: "/example", sourceDigest: "test", closurePackageIds: ["example 1"], features: [] };
const owner = { providerModuleId: "example", moduleSpecifier: "@example/index.js" };
const identity = name => ({ itemId: `example::${name}`, canonicalPath: ["example", name] });
const scalar = { kind: "primitive", name: "u64" };

function declaration(name) {
  const exported = { id: name, name, kind: "struct", canonicalPath: ["example", name], targetPath: ["example", name],
    genericParameters: [], associatedConstants: [], unsupportedMembers: [], traits: { implementations: [] },
    fields: [{ id: `${name}::field`, name: "count", type: scalar }],
    methods: [{ identity: identity(`${name}::visit`), name: "visit", receiver: { kind: "shared",
      lifetime: { kind: "elided", ownerIdentity: identity(`${name}::visit`).itemId, position: "parameter:0" },
      type: { kind: "reference", mutable: false,
        lifetime: { kind: "elided", ownerIdentity: identity(`${name}::visit`).itemId, position: "parameter:0" },
        target: { kind: "self", owner: identity(name) } } },
      parameters: [{ name: "visitor", type: { kind: "generic", name: "F", identity: identity(`${name}::F`) } }],
      result: { kind: "unit" }, asynchronous: false, unsafe: false, abi: "Rust", variadic: false, typeRequirements: [],
      genericParameters: [{ kind: "type", name: "F", identity: identity(`${name}::F`), outlives: [], maybeSized: false,
        requirements: [{ kind: "trait", trait: { identity: { itemId: "core::Fn", canonicalPath: ["core", "ops", "function", "Fn"] },
          path: "core::ops::function::Fn", genericArguments: [{ kind: "type", type: { kind: "tuple", elements: [scalar] } }],
          associatedConstraints: [{ kind: "equality", identity: identity("Output"), name: "Output", genericArguments: [], type: scalar }] } }] }] }],
  };
  for (const method of exported.methods) {
    const selected = selectRustCompilerResultLoans(method);
    method.resultLoans = selected.contract;
    method.resultLoanTypes = selected.types;
  }
  return exported;
}

function project(exports, materialization) {
  return projectRustCompilerModule({ protocolVersion: rustCompilerProviderProtocolVersion, projectDigest: "example", dependency, modulePath: [],
    exports, unsupportedExports: [], standardTypeLocations: [] }, owner, materialization);
}

test("normalized Self paths retain the same native owner traits and actual application arguments", () => {
  const parameter = { kind: "type", name: "Value", identity: identity("Owner::Value"), requirements: [],
    outlives: [], maybeSized: false, defaultType: { kind: "primitive", name: "bool" } };
  const traits = { implementations: [{ trait: { kind: "trait-ref", id: "core::clone::Clone",
    path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] },
    requirements: [{ typeArgumentIndex: 0, trait: { kind: "trait-ref", id: "core::clone::Clone",
      path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] } }] }] };
  const native = { kind: "path", identity: identity("Owner"), crateName: "example", modulePath: [], name: "Owner",
    genericArguments: [{ kind: "type", type: scalar }] };
  for (const standard of [false, true]) {
    const id = standard ? "exact-snapshot-owner" : compilerTargetTypeId(dependency, native.identity.canonicalPath);
    const context = { dependency, carrierPaths: new Map(), localTypeLocations: new Map(),
      genericNames: new Map(), defaultGenericBindings: undefined,
      standardTypes: new Map(standard ? [[native.identity.canonicalPath.join("\0"), {
        targetId: id, targetPath: ["example", "Owner"], genericParameters: [parameter],
      }]] : []),
      currentType: { carrier: rustNamedTargetType(id, "example::Owner", [{ kind: "type", type: { kind: "source-primitive", name: "uint64" } }], [], traits) } };
    context.localTypeLocations.set(native.identity.canonicalPath.join("\0"), {
      targetPath: ["example", "Owner"], genericParameters: [parameter], sourceExportName: "Owner",
    });
    const selected = rustNamedTypeCarrierValue(targetTypeFor(native, context, "result"));
    assert.equal(selected.traits === traits, true, "only the exact declared native identity supplies its complete trait evidence");
    assert.equal(selected.genericArguments.length, 1, "the authored application keeps its original argument");
    assert.equal(selected.genericArguments[0].type.name, "uint64", "the actual argument is not replaced by the owner's generic placeholder");
    assert.equal(selected.genericDefaults[0].type.name, "bool", "the original native declaration default is retained");
    context.currentType = { carrier: rustNamedTargetType("different-native-owner", "example::Owner",
      [{ kind: "type", type: { kind: "source-primitive", name: "uint64" } }], [], traits) };
    assert.equal(rustNamedTypeCarrierValue(targetTypeFor(native, context, "result")).traits.implementations.length, 0,
      "equal path spelling cannot borrow a different declaration's native trait contract");
  }
});

test("native Self trait metadata substitutes the actual arguments and defaults without leaking declaration binders", () => {
  const lifetime = { kind: "lifetime", lifetime: { kind: "parameter", identity: identity("Owner::owner"), name: "owner" }, outlives: [] };
  const parameter = { kind: "type", name: "Value", identity: identity("Owner::Value"), requirements: [], outlives: [], maybeSized: false };
  const count = { kind: "const", name: "Count", identity: identity("Owner::Count"), type: { kind: "primitive", name: "usize" } };
  const allocator = { kind: "type", name: "Allocator", identity: identity("Owner::Allocator"), requirements: [],
    outlives: [], maybeSized: false, defaultType: { kind: "primitive", name: "bool" } };
  const valueReference = { kind: "type-parameter", identity: parameter.identity.itemId, name: "Value" };
  const allocatorReference = { kind: "type-parameter", identity: allocator.identity.itemId, name: "Allocator" };
  const lifetimeReference = { kind: "parameter", identity: lifetime.lifetime.identity.itemId, name: "owner" };
  const countReference = { kind: "parameter", identity: count.identity.itemId, name: "Count" };
  const trait = { kind: "trait-ref", id: "example::NativeTrait", path: "example::NativeTrait",
    genericArguments: [{ kind: "type", type: valueReference }, { kind: "type", type: allocatorReference },
      { kind: "lifetime", lifetime: lifetimeReference }, { kind: "const", value: countReference }], associatedConstraints: [] };
  const traits = { implementations: [{ trait, requirements: [{ typeArgumentIndex: 1, trait }] }] };
  const native = { kind: "path", identity: identity("Owner"), crateName: "example", modulePath: [], name: "Owner",
    genericArguments: [{ kind: "lifetime", lifetime: { kind: "static" } }, { kind: "type", type: scalar },
      { kind: "const", value: { kind: "integer", value: "7" } }] };
  for (const standard of [false, true]) {
    const id = standard ? "exact-snapshot-owner" : compilerTargetTypeId(dependency, native.identity.canonicalPath);
    const context = { dependency, carrierPaths: new Map(), localTypeLocations: new Map(), genericNames: new Map(),
      defaultGenericBindings: undefined,
      standardTypes: new Map(standard ? [[native.identity.canonicalPath.join("\0"), {
        targetId: id, targetPath: ["example", "Owner"], genericParameters: [lifetime, parameter, count, allocator],
      }]] : []),
      currentType: { carrier: rustNamedTargetType(id, "example::Owner", [{ kind: "lifetime", lifetime: lifetimeReference },
        { kind: "type", type: valueReference }, { kind: "const", value: countReference },
        { kind: "type", type: allocatorReference }], [{ kind: "type", type: { kind: "source-primitive", name: "bool" } }], traits) } };
    context.localTypeLocations.set(native.identity.canonicalPath.join("\0"), {
      targetPath: ["example", "Owner"], genericParameters: [lifetime, parameter, count, allocator], sourceExportName: "Owner",
    });
    const selected = rustNamedTypeCarrierValue(targetTypeFor(native, context, "result"));
    assert.equal(selected !== undefined, true, "the completed native application retains its valid nominal contract");
    assert.equal(selected.genericArguments[1].type.name, "uint64", "the actual native argument is retained");
    assert.equal(selected.genericArguments[3].type.name, "bool", "the omitted allocator uses its exact declared default");
    for (const selectedTrait of [selected.traits.implementations[0].trait, selected.traits.implementations[0].requirements[0].trait]) {
      assert.equal(selectedTrait.id, trait.id, "native declaration identity is never replaced");
      assert.equal(selectedTrait.genericArguments[0].type.name, "uint64", "implementation and conditional bound share the same actual Value");
      assert.equal(selectedTrait.genericArguments[1].type.name, "bool", "the declaration allocator binder is substituted in every trait position");
      assert.equal(selectedTrait.genericArguments[2].lifetime.kind, "static", "the original lifetime binder is replaced by its exact actual lifetime");
      assert.equal(selectedTrait.genericArguments[3].value.kind, "integer", "the native const binder is instantiated without a spelling guess");
      assert.equal(selectedTrait.genericArguments[3].value.value, "7", "the exact native const value is retained in every bound");
    }
    assert.equal(trait.genericArguments[1].type === allocatorReference, true, "the original declaration evidence is immutable and is not rewritten");
  }
});

test("native trait projection preserves instantiated arguments and conditional bounds including Self", () => {
  const exported = declaration("First");
  exported.genericParameters = [{ kind: "type", identity: identity("First::Value"), name: "Value",
    requirements: [], outlives: [], maybeSized: false }];
  const trait = { identity: { itemId: "core::Into", canonicalPath: ["core", "convert", "Into"] },
    path: "core::convert::Into", genericArguments: [{ kind: "type", type: scalar }], associatedConstraints: [] };
  const selfTrait = { identity: { itemId: "core::PartialEq", canonicalPath: ["core", "cmp", "PartialEq"] },
    path: "core::cmp::PartialEq", genericArguments: [{ kind: "type", type: { kind: "self" } }], associatedConstraints: [] };
  exported.traits = { implementations: [
    { trait: { kind: "trait", trait }, requirements: [{ typeArgumentIndex: 0, requirement: { kind: "trait", trait } }] },
    { trait: { kind: "trait", trait: selfTrait }, requirements: [] },
  ] };
  const selected = project([exported], { kind: "incremental", completeExports: [] });
  const native = selected.types.find(row => row.targetCarrier.value?.path === "example::First").targetCarrier.value;
  const implemented = native.traits.implementations.find(row => row.trait.path === "core::convert::Into");
  assert.deepEqual(implemented.trait.genericArguments, [{ kind: "type", type: { kind: "source-primitive", name: "uint64" } }]);
  assert.deepEqual(implemented.requirements[0].trait.genericArguments, implemented.trait.genericArguments);
  assert.equal(implemented.requirements[0].typeArgumentIndex, 0);
  const equality = native.traits.implementations.find(row => row.trait.path === "core::cmp::PartialEq");
  assert.equal(equality.trait.genericArguments[0].type.value.path, "example::First");
  assert.deepEqual(equality.trait.genericArguments[0].type.value.traits.implementations, []);
});

test("native declarations materialize only demanded members with stable identities and metadata", () => {
  const exports = [declaration("First"), declaration("Second")];
  const headers = project(exports, { kind: "incremental", completeExports: [] });
  assert.equal(headers.operations.length, 0);
  assert.equal(headers.completeExports.size, 0);
  assert.ok(headers.declarationModel.exports.every(value => value.members.length === 0));
  const first = headers.declarationModel.exports[0];
  const demand = { kind: "incremental", completeExports: [{ exportName: "First", exportId: first.id }] };
  const selected = project(exports, demand);
  const complete = project(exports, { kind: "complete" });
  assert.deepEqual(selected.declarationModel.exports[0], complete.declarationModel.exports[0]);
  assert.equal(selected.declarationModel.exports[1].members.length, 0);
  assert.deepEqual(selected.types, complete.types);
  assert.deepEqual([...selected.completeExports], [first.id]);
  const reversed = project([...exports].reverse(), demand);
  assert.deepEqual(reversed.declarationModel.exports[1], selected.declarationModel.exports[0]);
  const isolated = project([exports[0]], demand);
  assert.deepEqual(isolated.declarationModel.exports[0], selected.declarationModel.exports[0]);
  const wrongIdentity = project(exports, { kind: "incremental", completeExports: [{ exportName: "First", exportId: "unrelated" }] });
  assert.equal(wrongIdentity.completeExports.size, 0);
  assert.equal(wrongIdentity.operations.length, 0);
});

test("primitive methods use exact compiler carriers under export aliases and namespace materialization", () => {
  const primitive = { id: "compiler:u32", kind: "primitive", name: "Integer", canonicalPath: ["core", "u32"],
    targetPath: ["core", "u32"], type: { kind: "primitive", name: "u32" }, associatedConstants: [], unsupportedMembers: [],
    methods: [{ identity: identity("method"), name: "selected", receiver: { kind: "value", type: { kind: "primitive", name: "u32" } },
      parameters: [{ name: "right", type: { kind: "primitive", name: "u32" } }],
      result: { kind: "primitive", name: "u32" }, asynchronous: false, unsafe: false, abi: "Rust", variadic: false,
      typeRequirements: [], genericParameters: [] }] };
  for (const method of primitive.methods) {
    const selected = selectRustCompilerResultLoans(method);
    method.resultLoans = selected.contract;
    method.resultLoanTypes = selected.types;
  }
  const header = project([primitive], { kind: "incremental", completeExports: [] });
  assert.equal(header.declarationModel.exports[0].kind, "namespace");
  assert.equal(header.declarationModel.exports[0].members.length, 1);
  assert.equal(header.operations.length, 1);
  assert.equal(header.types.length, 0);
  assert.equal(header.completeExports.size, 1);
  const complete = project([primitive], { kind: "complete" });
  assert.deepEqual(header.declarationModel, complete.declarationModel);
  assert.equal(complete.operations.length, 1);
  assert.equal(complete.types.length, 0);
  assert.equal(complete.operations[0].target.path, "core::primitive::u32::selected");
  assert.equal(complete.operations[0].parameterCarriers.length, 2);
  const demand = project([primitive], { kind: "incremental", completeExports: [{ exportName: "Integer", exportId: header.declarationModel.exports[0].id }] });
  assert.deepEqual(demand.declarationModel, complete.declarationModel);
  assert.deepEqual(demand.operations, complete.operations);
});

test("associated projection helper defaults are removed once without altering native trait defaults", () => {
  const generic = { kind: "type", identity: identity("Combine::Value"), name: "Value", requirements: [],
    outlives: [], maybeSized: false, defaultType: scalar };
  const associated = { identity: identity("Combine::Output"), name: "Output", genericParameters: [],
    requirements: [], outlives: [], maybeSized: false, ownerRequirements: [], ownerOutlives: [], ownerMaybeSized: false };
  const trait = { id: "Combine", kind: "trait", name: "Combine", canonicalPath: ["example", "Combine"],
    targetPath: ["example", "Combine"], genericParameters: [generic], methods: [], associatedConstants: [],
    associatedTypes: [associated], unsupportedMembers: [], superTraits: [], outlives: [], auto: false, unsafe: false };
  const projected = project([trait], { kind: "complete" });
  const original = projected.declarationModel.exports.find(value => value.name === "Combine");
  const helper = projected.declarationModel.exports.find(value => value.id.includes("::associated-type:"));
  const relation = projected.types.find(value => value.exportId === helper.id);
  assert.ok(original.typeParameters[0].defaultType);
  assert.deepEqual(trait.genericParameters, [generic]);
  assert.equal(helper.typeParameters.length, 2);
  assert.ok(helper.typeParameters.every(parameter => parameter.defaultType === undefined));
  assert.deepEqual(relation.genericParameters.map(parameter => parameter.sourceName), helper.typeParameters.map(parameter => parameter.name));
  assert.ok(relation.genericParameters.every(parameter => parameter.defaultArgument === undefined));
  assert.equal(relation.targetCarrier.kind, "associated-type");
});

test("associated constants follow inherent precedence without resolving ambiguous trait constants", () => {
  const trait = name => ({ identity: identity(name), path: `example::${name}`,
    genericArguments: [], associatedConstraints: [] });
  const constant = (name, owner) => ({ id: `${owner ?? "inherent"}::${name}`, name, type: scalar,
    typeRequirements: [], ...(owner === undefined ? {} : { traitDispatch: trait(owner) }) });
  const constants = [constant("BOUND", "First"), constant("BOUND"), constant("BOUND", "Second"),
    constant("AMBIGUOUS", "First"), constant("AMBIGUOUS", "Second"), constant("UNIT", "First"),
    constant("DUPLICATE"), constant("DUPLICATE")];
  const exported = { ...declaration("Limits"), methods: [], fields: [], associatedConstants: constants };
  const result = project([exported], { kind: "complete" });
  const members = result.declarationModel.exports[0].members;
  assert.deepEqual(members.map(member => member.name).sort(), ["BOUND", "UNIT"]);
  const bound = result.operations.find(operation => operation.memberId.endsWith(":BOUND"));
  assert.equal(bound.target.form, "associated-value");
  assert.equal(bound.target.name, "BOUND");
  const unit = result.operations.find(operation => operation.memberId.endsWith(":UNIT"));
  assert.equal(unit.target.form, "trait-associated-value");
  assert.equal(unit.target.traitPath, "example::First");
  const reordered = project([{ ...exported, associatedConstants: [...constants].reverse() }], { kind: "complete" });
  assert.deepEqual(reordered.operations.toSorted((left, right) => left.memberId.localeCompare(right.memberId)),
    result.operations.toSorted((left, right) => left.memberId.localeCompare(right.memberId)));
});

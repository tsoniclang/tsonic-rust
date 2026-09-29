import assert from "node:assert/strict";
import test from "node:test";
import { projectRustCompilerModule } from "../../../../dist/providers/native/projection/declarations.js";
import { rustCompilerProviderProtocolVersion } from "../../../../dist/providers/native/model/model.js";

const dependency = { alias: "example", packageId: "example 1", packageName: "example", packageVersion: "1",
  crateName: "example", targetCrateName: "example", manifestPath: "/example/Cargo.toml",
  sourceRoot: "/example", sourceDigest: "test", closurePackageIds: ["example 1"], features: [] };
const owner = { providerModuleId: "example", moduleSpecifier: "@example/index.js" };
const identity = name => ({ itemId: `example::${name}`, canonicalPath: ["example", name] });
const scalar = { kind: "primitive", name: "u64" };

function declaration(name) {
  return { id: name, name, kind: "struct", canonicalPath: ["example", name], targetPath: ["example", name],
    genericParameters: [], associatedConstants: [], unsupportedMembers: [], traits: { implementations: [] },
    fields: [{ id: `${name}::field`, name: "count", type: scalar }],
    methods: [{ identity: identity(`${name}::visit`), name: "visit", receiver: { kind: "shared" },
      parameters: [{ name: "visitor", type: { kind: "generic", name: "F", identity: identity(`${name}::F`) } }],
      result: { kind: "unit" }, asynchronous: false, unsafe: false, abi: "Rust", variadic: false, typeRequirements: [],
      genericParameters: [{ kind: "type", name: "F", identity: identity(`${name}::F`), outlives: [], maybeSized: false,
        requirements: [{ kind: "trait", trait: { identity: { itemId: "core::Fn", canonicalPath: ["core", "ops", "function", "Fn"] },
          path: "core::ops::function::Fn", genericArguments: [{ kind: "type", type: { kind: "tuple", elements: [scalar] } }],
          associatedConstraints: [{ kind: "equality", identity: identity("Output"), name: "Output", genericArguments: [], type: scalar }] } }] }] }],
  };
}

function project(exports, materialization) {
  return projectRustCompilerModule({ protocolVersion: rustCompilerProviderProtocolVersion, projectDigest: "example", dependency, modulePath: [],
    exports, unsupportedExports: [], standardTypeLocations: [] }, owner, materialization);
}

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
    methods: [{ identity: identity("method"), name: "selected", receiver: { kind: "value" },
      parameters: [{ name: "right", type: { kind: "primitive", name: "u32" } }],
      result: { kind: "primitive", name: "u32" }, asynchronous: false, unsafe: false, abi: "Rust", variadic: false,
      typeRequirements: [], genericParameters: [] }] };
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

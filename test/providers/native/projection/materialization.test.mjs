import assert from "node:assert/strict";
import test from "node:test";
import { projectRustCompilerModule } from "../../../../dist/providers/native/projection/declarations.js";

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
  return projectRustCompilerModule({ protocolVersion: 5, projectDigest: "example", dependency, modulePath: [],
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

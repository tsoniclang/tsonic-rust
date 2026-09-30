import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeFamilyRegistry } from "../../../../dist/analysis/project-types/type-families.js";
import { rustSourceOptionalTargetType } from "../../../../dist/target-model/types/projections.js";
import { rustOptionalStorageCallArguments } from "../../../../dist/backend/planner/types/type-projections.js";

test("optional call storage consumes the sealed native family output after exact substitution", () => {
  const parameter = { kind: "type-parameter", identity: "payload-identity", name: "Payload" };
  const owner = { kind: "source-primitive", name: "int64" };
  const output = { kind: "source-primitive", name: "uint64" };
  const family = { kind: "conditional", declaration: {}, parameter: {}, trait: {
    kind: "trait-ref", id: "storage", path: "Storage", sourceItem: { fileName: "/storage.ts", typeName: "Storage" },
    genericArguments: [], associatedConstraints: [],
  } };
  const registry = createRustSourceTypeFamilyRegistry();
  assert.equal(registry.register(family), true);
  assert.equal(registry.registerImplementation({ family, arguments: [], owner, output, sourceFileName: "/storage.ts" }), true);
  const carrier = rustSourceOptionalTargetType({ kind: "associated-type", owner: parameter, trait: family.trait, name: "Output" });
  const declaration = {};
  const context = { input: { program: {
    typeFamilies: registry.seal(),
    declarationGenericRequirements: { contractFor: selected => selected === declaration
      ? { optionalStorage: [{ carrier, captured: false, requirements: [] }] } : undefined },
  } } };
  assert.deepEqual(rustOptionalStorageCallArguments(declaration, new Map([[parameter.identity, owner]]), context),
    [{ kind: "type", type: { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: { kind: "primitive", name: "u64" } }] } }]);
  assert.deepEqual(rustOptionalStorageCallArguments(declaration, new Map([["other-identity", owner]]), context),
    [{ kind: "type", type: { kind: "named", path: carrier.name } }]);
  assert.throws(() => rustOptionalStorageCallArguments({}, new Map(), context), /sealed generic requirements/u);
});

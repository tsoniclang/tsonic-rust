import assert from "node:assert/strict";
import test from "node:test";
import { canRequireSourceClone } from "../../../dist/analysis/operations/provider/clone-requirements.js";
import { createRustSourceTypeFamilyRegistry } from "../../../dist/analysis/project-types/type-families.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";

test("native provider Clone obligations use exact lexical binders and registered type families", () => {
  const parameter = { kind: "type-parameter", identity: "owner:T", name: "T" };
  const foreign = { ...parameter, identity: "other:T" };
  const expression = {};
  const declaration = {};
  const context = { ast: { parent: node => node === expression ? declaration : undefined },
    sourceLifetimes: { contractFor: node => node === declaration ? {
      parameters: [{ kind: "type", identity: parameter.identity }],
    } : undefined }, typeDefinitions: {},
  };
  const family = { kind: "conditional", declaration, parameter: {}, trait: {
    kind: "trait-ref", id: "storage", path: "Storage", sourceItem: { fileName: "/storage.ts", typeName: "Storage" },
    genericArguments: [], associatedConstraints: [],
  } };
  const families = createRustSourceTypeFamilyRegistry();
  assert.equal(families.register(family), true);
  const projection = { kind: "associated-type", owner: parameter, trait: family.trait, name: "Output" };
  for (const carrier of [parameter, projection, rustSourceOptionalTargetType(parameter), rustSourceOptionalTargetType(projection)]) {
    assert.equal(canRequireSourceClone(carrier, expression, context, families), true);
  }
  for (const carrier of [foreign, { ...projection, owner: foreign },
    { ...projection, trait: { ...family.trait, id: "unregistered" } }, rustSourceOptionalTargetType(foreign)]) {
    assert.equal(canRequireSourceClone(carrier, expression, context, families), false);
  }
});

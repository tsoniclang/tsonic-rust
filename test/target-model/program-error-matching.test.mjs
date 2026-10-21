import assert from "node:assert/strict";
import test from "node:test";
import { rustProgramErrorTargetType } from "../../dist/target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { inferRustTargetTypeParameterBindings, rustTargetTypePatternsAreNominallyDisjoint } from "../../dist/target-model/types/carriers/generic-inference.js";
import { rustIndexedFieldKey, rustIndexedFieldTrait } from "../../dist/target-model/types/carriers/indexed-fields.js";
import { createRustSourceTypeFamilyRegistry } from "../../dist/analysis/project-types/type-families.js";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { rustPhysicalPayloadFor } from "../../dist/policy/conversions/physical-payloads.js";
import { rustSourceUnionTargetType } from "../../dist/target-model/types/carriers/source-types.js";

const owners = [{ kind: "logical" }, { kind: "physical", domain: "runtime" },
  { kind: "physical", domain: "project", componentId: "left" },
  { kind: "physical", domain: "project", componentId: "right" }];
const errors = owners.map(rustProgramErrorTargetType);
const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
const integer = { kind: "source-primitive", name: "int32" };
const tuple = (error, value) => ({ kind: "tuple", elements: [error, value] });

test("generic inference retains exact program error owners in nested patterns", () => {
  for (const [leftIndex, left] of errors.entries()) {
    for (const [rightIndex, right] of errors.entries()) {
      const selected = inferRustTargetTypeParameterBindings(tuple(left, parameter), tuple(right, integer), new Set(["Value"]));
      assert.equal(selected !== undefined, leftIndex === rightIndex, `${leftIndex}:${rightIndex}`);
      if (selected !== undefined) assert.equal(selected.get("Value") === integer, true);
      assert.equal(rustTargetTypePatternsAreNominallyDisjoint(tuple(left, parameter), tuple(right, parameter)),
        leftIndex !== rightIndex && leftIndex !== 0 && rightIndex !== 0, `nominal ${leftIndex}:${rightIndex}`);
    }
  }
});

test("generic matching rejects malformed owner metadata without evaluating accessors", () => {
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "kind", { enumerable: true, get() { reads++; return "logical"; } });
  for (const errorOwner of [undefined, {}, { kind: "physical", domain: "project" }, accessor]) {
    const malformed = { ...errors[0], errorOwner };
    assert.equal(inferRustTargetTypeParameterBindings(malformed, malformed, new Set()) === undefined, true);
    assert.equal(inferRustTargetTypeParameterBindings(parameter, malformed, new Set(["Value"])) === undefined, true);
  }
  assert.equal(reads, 0);
});

test("indexed property templates retain program error owners in both keys and generic matching", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  const family = { kind: "indexed", trait: rustIndexedFieldTrait };
  const fieldKey = rustIndexedFieldKey("00000000000000000000000000000001");
  const arguments_ = [{ kind: "type", type: fieldKey }];
  const trait = { ...family.trait, genericArguments: arguments_ };
  assert.equal(registry.register(family), true);
  for (const [index, error] of errors.slice(1).entries()) {
    assert.equal(registry.implementation(trait, tuple(error, integer)) === undefined, true);
    assert.equal(registry.registerImplementation({ family, arguments: arguments_, owner: tuple(error, parameter),
      output: parameter, sourceFileName: `/source/${index}.ts`,
      field: { storage: "structural-object", storageIndex: index, readonly: true, sharedWrite: false } }), true);
  }
  for (const [index, error] of errors.slice(1).entries()) {
    const selected = registry.implementation(trait, tuple(error, integer));
    assert.equal(selected !== undefined, true);
    assert.equal(selected.field.storageIndex, index);
    assert.equal(selected.output === integer, true);
  }
  assert.equal(registry.implementation(trait, tuple(errors[0], integer)) === undefined, true);
});

test("physical union projection cannot select a same-id error belonging to another owner", () => {
  const definitions = createRustTypeDefinitionRegistry();
  const carrier = rustSourceUnionTargetType("/source/errors.ts", "Errors");
  assert.equal(definitions.registerSourceUnion({ carrier,
    variants: [{ name: "Runtime", carrier: errors[1] }, { name: "Project", carrier: errors[2] }] }, true), true);
  assert.equal(rustTargetTypeRefEquals(rustPhysicalPayloadFor(carrier, carrier, errors[1], definitions), errors[1]), true);
  assert.equal(rustTargetTypeRefEquals(rustPhysicalPayloadFor(carrier, carrier, errors[2], definitions), errors[2]), true);
  assert.equal(rustPhysicalPayloadFor(carrier, carrier, errors[3], definitions) === undefined, true);
  assert.equal(rustPhysicalPayloadFor(carrier, carrier, errors[0], definitions) === undefined, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceTypeFamilyRegistry } from "../../../../dist/analysis/project-types/type-families.js";
import { rustSourceOptionalTargetType } from "../../../../dist/target-model/types/projections.js";
import { analyzeRustOptionalStorageCallEmission, analyzeRustOptionalStorageTypeEmission } from "../../../../dist/analysis/project-types/optional-storage-emission.js";
import { createRustProjectEmissionProducer } from "../../../../dist/analysis/program/records/program/project-emission.js";
import { rustOptionalStorageCallArguments, rustOptionalStorageTypeArguments } from "../../../../dist/backend/planner/types/type-projections.js";
import { closedMetadataKey } from "../../../../dist/target-model/metadata/closed-data.js";
import { createRustRecordFixture } from "../../../helpers/records.mjs";

// A source call's optional storage arguments are substituted and normalized in analysis
// (analyzeRustOptionalStorageCallEmission) and sealed as optionalStorageCallArguments; the planner only renders them.
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
  const call = {};
  const sealed = boundIdentity => {
    const records = createRustRecordFixture({
      targetOperation: { get: node => node === call ? { kind: "source-call", target: { form: "callable" },
        targetGenericArguments: [{ kind: "type", type: owner }] } : undefined },
      selectedCall: { get: node => node === call ? { sourceDeclaration: declaration } : undefined },
    });
    const producer = createRustProjectEmissionProducer(() => {});
    analyzeRustOptionalStorageCallEmission({ records, typeFamilies: registry.seal(),
      declarationGenericRequirements: { contractFor: selected => selected === declaration
        ? { typeParameters: [{ identity: boundIdentity }], optionalStorage: [{ carrier, captured: false, requirements: [] }] }
        : undefined },
      projectTypes: { definitions: [], definitionForCarrier: () => undefined },
      structuralShapes: { instances: [] }, physicalEmissionContexts: { contexts: [], operands: [] } }, [call], producer);
    return producer.records;
  };
  assert.deepEqual(sealed(parameter.identity).optionalStorageCallArguments.get(call), [rustSourceOptionalTargetType(output)]);
  assert.deepEqual(sealed("other-identity").optionalStorageCallArguments.get(call), [carrier]);
  assert.throws(() => rustOptionalStorageCallArguments({}, { input: { program: { records: sealed(parameter.identity) } } }),
    /exact sealed optional storage arguments/u);
});

test("missing optional TYPE rows report their exact full or indexed key without fabricating an empty row", () => {
  const carrier = { kind: "source-primitive", name: "int32" };
  const producer = createRustProjectEmissionProducer(() => {});
  const context = { input: { program: { records: producer.records } } };
  for (const indexes of [undefined, [], [1, 0]]) {
    const key = closedMetadataKey([carrier, indexes ?? null]);
    assert.throws(() => rustOptionalStorageTypeArguments(carrier, context, indexes), error =>
      error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" && error.diagnostic.message ===
        `An admitted native type requires its exact sealed optional storage arguments. key=${key}`);
    assert.equal(producer.records.optionalStorageTypeArguments.get(carrier, indexes) === undefined, true,
      "a missing native argument key remains absent after its invariant failure");
  }
  analyzeRustOptionalStorageTypeEmission({ projectTypes: { definitionForCarrier: () => undefined } }, carrier, producer);
  assert.deepEqual(rustOptionalStorageTypeArguments(carrier, context), [],
    "a proven native empty row retains its ordinary successful rendering");
  assert.equal(producer.records.optionalStorageTypeArguments.get(carrier, []) === undefined, true,
    "publishing the full native row does not invent an indexed row");
});

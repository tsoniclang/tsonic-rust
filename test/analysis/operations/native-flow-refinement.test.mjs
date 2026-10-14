import assert from "node:assert/strict";
import test from "node:test";
import { selectRustGuardedValueCarrier } from "../../../dist/analysis/operations/native-flow-refinement.js";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/resolution/value-carrier-reconciliation.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustFlowReadProjectionQueries } from "../../../dist/analysis/control-flow/flow-read-projections.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceUnionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

test("guarded reads consume exact finalized projections without weaker republication", () => {
  const integer = rustSourcePrimitiveTargetType("uint64");
  const union = rustSourceUnionTargetType("/src/index.ts", "Values");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: union, variants: [
    { name: "Wide", carrier: integer }, { name: "Text", carrier: rustStringTargetType() },
  ] }, true), true);
  const definitions = registry.seal();
  const projectTypes = { definitionForCarrier: () => undefined };
  const fact = selectRustFlowReadProjection(union, integer, projectTypes, definitions).fact;
  const subject = {};
  let existing = fact;
  let reads = 0;
  const readers = createRustRecordFixture({
    flowReadProjection: {
      get: node => { assert.equal(node === subject, true, "exact projection subject"); reads += 1; return existing; },
    },
  });
  const context = { typeDefinitions: definitions, records: { ...readers,
    flowReadProjections: createRustFlowReadProjectionQueries({ assertOpen: () => {}, records: readers.flowReadProjection,
      publish: () => assert.fail("A finalized expression projection must not be republished"),
    }),
  }, get source() { assert.fail("A finalized expression projection must not reconstruct guard evidence"); } };
  assert.equal(selectRustGuardedValueCarrier(subject, union, context, { projectTypes }), integer);
  assert.equal(selectRustGuardedValueCarrier(subject, integer, context, { projectTypes }), undefined);
  assert.equal(reads, 2, "both finalized reads use the canonical projection family");
  for (const invalid of [
    { ...fact, variant: "Missing" },
    { ...fact, selectedCarrier: rustSourcePrimitiveTargetType("int64") },
    { ...fact, dispatchCarrier: integer },
  ]) {
    existing = invalid;
    assert.equal(selectRustGuardedValueCarrier(subject, union, context, { projectTypes }), undefined);
  }
  assert.equal(reads, 5, "adverse evidence stays in the same canonical family");
});

import assert from "node:assert/strict";
import test from "node:test";
import { selectRustGuardedValueCarrier } from "../../../dist/analysis/operations/native-flow-refinement.js";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { rustFlowReadProjectionFactKey } from "../../../dist/analysis/facts/keys.js";
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
  const context = { typeDefinitions: definitions, facts: {
    getFact: (node, key) => { assert.equal(node, subject); assert.equal(key, rustFlowReadProjectionFactKey); return existing; },
    set: () => assert.fail("A finalized expression projection must not be republished"),
  }, get source() { assert.fail("A finalized expression projection must not reconstruct guard evidence"); } };
  assert.equal(selectRustGuardedValueCarrier(subject, union, context, { projectTypes }), integer);
  assert.equal(selectRustGuardedValueCarrier(subject, integer, context, { projectTypes }), undefined);
  for (const invalid of [
    { ...fact, variant: "Missing" },
    { ...fact, selectedCarrier: rustSourcePrimitiveTargetType("int64") },
    { ...fact, dispatchCarrier: integer },
  ]) {
    existing = invalid;
    assert.equal(selectRustGuardedValueCarrier(subject, union, context, { projectTypes }), undefined);
  }
});

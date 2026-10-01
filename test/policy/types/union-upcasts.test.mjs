import assert from "node:assert/strict";
import test from "node:test";
import { selectRustValueCarrierReconciliation, selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { rustFlowReadProjectionMatches } from "../../../dist/analysis/facts/flow-read-projections.js";
import { rustFlowReadProjectionFactKey } from "../../../dist/analysis/facts/value-projections.js";
import { selectRustCallableValueAdapter } from "../../../dist/analysis/callables/adapters.js";
import { recordRustValueCarrierReconciliation, rustEffectiveValueCarrier } from "../../../dist/analysis/facts/value-carrier-queries.js";
import { rustProjectUpcastFactKey, rustContextualValueConversionFactKey } from "../../../dist/analysis/facts/keys.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustOptionTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

const derived = { kind: "target-named", id: "test.Derived" };
const base = { kind: "target-named", id: "test.Base" };
const otherBase = { kind: "target-named", id: "test.OtherBase" };
const union = { kind: "target-named", id: "test.Union" };

function policy(carriers, ambiguous = false) {
  return {
    definitions: { ...emptyRustTypeDefinitions, sourceUnionVariants: carrier => carrier === union
      ? carriers.map((carrier, index) => ({ name: `Variant${index}`, carrier })) : undefined },
    projectTypes: {
      definitionForCarrier: carrier => carrier === base || carrier === otherBase ? carrier : undefined,
      relationship: (source, target) => source !== derived ? { kind: "unrelated" }
        : ambiguous ? { kind: "ambiguous" } : { kind: "related", targetType: target },
    },
  };
}

test("native upcasts precede exact union injection in expression and callable contracts", () => {
  const { projectTypes, definitions } = policy([rustStringTargetType(), base]);
  const selected = selectRustValueCarrierReconciliation(derived, union, projectTypes, definitions);
  assert.equal(selected.kind, "conversion");
  assert.deepEqual(selected.upcast, { sourceCarrier: derived, targetCarrier: base });
  assert.deepEqual(selected.fact, { sourceCarrier: base, targetCarrier: union,
    conversion: { kind: "source-union-variant", source: base, target: union, variantName: "Variant1" } });
  const written = new Map();
  const subject = {};
  const facts = { set: (_, key, value) => written.set(key, value), getFact: (_, key) => written.get(key),
    getTargetConversionFact() {}, getRuntimeCarrierFact: () => ({ carrier: derived }) };
  recordRustValueCarrierReconciliation(facts, subject, selected);
  assert.deepEqual([...written.keys()], [rustProjectUpcastFactKey, rustContextualValueConversionFactKey]);
  assert.deepEqual(rustEffectiveValueCarrier(facts, subject), union);
  const adapter = selectRustCallableValueAdapter(derived, union, projectTypes, definitions);
  assert.deepEqual(adapter.upcast, selected.upcast);
  assert.deepEqual(adapter.conversion, selected.fact.conversion);
});

test("native upcasts retain the complete nested union destination and reject ambiguous payloads", () => {
  const nested = { kind: "target-named", id: "test.Nested" };
  const { projectTypes, definitions } = policy([rustStringTargetType(), base]);
  const nestedDefinitions = { ...definitions, sourceUnionVariants: carrier => carrier === nested
    ? [{ name: "Flag", carrier: { kind: "source-primitive", name: "bool" } }, { name: "Values", carrier: union }]
    : definitions.sourceUnionVariants(carrier) };
  const selected = selectRustValueCarrierReconciliation(derived, nested, projectTypes, nestedDefinitions);
  assert.equal(selected.kind, "conversion");
  assert.deepEqual(selected.upcast, { sourceCarrier: derived, targetCarrier: base });
  assert.deepEqual(selected.fact, { sourceCarrier: base, targetCarrier: nested,
    conversion: { kind: "source-union-variant", source: base, target: nested, variantName: "Values" } });
  for (const changed of [
    { ...projectTypes, relationship: () => ({ kind: "unrelated" }) },
    { ...projectTypes, relationship: () => ({ kind: "ambiguous" }) },
    { ...projectTypes, relationship: () => ({ kind: "related", targetType: otherBase }) },
  ]) assert.equal(selectRustValueCarrierReconciliation(derived, nested, changed, nestedDefinitions).kind, "incompatible");
  const duplicate = { ...nestedDefinitions, sourceUnionVariants: carrier => carrier === nested
    ? [{ name: "First", carrier: union }, { name: "Second", carrier: union }] : definitions.sourceUnionVariants(carrier) };
  assert.equal(selectRustValueCarrierReconciliation(derived, nested, projectTypes, duplicate).kind, "incompatible");
});

test("union flow retains exact nominal payload refinement and rejects forged or ambiguous routes", () => {
  const { definitions } = policy([rustStringTargetType(), base]);
  const projectTypes = {
    definitionForCarrier: carrier => carrier === base || carrier === derived ? carrier : undefined,
    relationship: (source, target) => source === derived && target === base
      ? { kind: "related", targetType: base } : { kind: "unrelated" },
    downcastRoute: () => ({ kind: "closed", slot: "projectChild" }),
  };
  for (const sourceCarrier of [union, rustOptionTargetType(union)]) {
    const selected = selectRustFlowReadProjection(sourceCarrier, derived, projectTypes, definitions);
    assert.equal(selected.kind, "projection");
    assert.equal(selected.fact.variant, "Variant1");
    assert.deepEqual(selected.fact.project, { sourceCarrier: base, dispatchCarrier: base, targetCarrier: derived,
      projection: { kind: "closed", slot: "projectChild" } });
    assert.equal(rustFlowReadProjectionMatches(selected.fact, projectTypes, definitions), true);
    for (const changed of [
      { ...selected.fact, variant: "Variant0" }, { ...selected.fact, project: undefined },
      { ...selected.fact, project: { ...selected.fact.project, targetCarrier: base } },
      { ...selected.fact, project: { ...selected.fact.project, projection: { kind: "generic" } } },
      { ...selected.fact, project: { ...selected.fact.project, projection: { kind: "closed", slot: "forged" } } },
    ]) {
      assert.equal(rustFlowReadProjectionMatches(changed, projectTypes, definitions), false);
      assert.equal(rustFlowReadProjectionFactKey.equals(selected.fact, changed), false);
    }
  }
  const duplicate = { ...definitions, sourceUnionVariants: carrier => carrier === union
    ? [{ name: "First", carrier: base }, { name: "Second", carrier: base }] : undefined };
  assert.equal(selectRustFlowReadProjection(union, derived, projectTypes, duplicate).kind, "incompatible");
});

test("exact union payloads win and ambiguous native upcasts remain rejected", () => {
  for (const [carriers, ambiguous, expected] of [
    [[derived, base], false, "conversion"], [[base, otherBase], false, "ambiguous"],
    [[base], true, "ambiguous"], [[rustStringTargetType()], false, "unrelated"],
  ]) {
    const { projectTypes, definitions } = policy(carriers, ambiguous);
    const selected = selectRustValueCarrierReconciliation(derived, union, projectTypes, definitions);
    if (expected === "conversion") {
      assert.equal(selected.kind, "conversion");
      assert.equal(selected.upcast, undefined);
      assert.equal(selected.fact.conversion.variantName, "Variant0");
    } else assert.deepEqual(selected, { kind: "incompatible", reason: expected });
  }
});

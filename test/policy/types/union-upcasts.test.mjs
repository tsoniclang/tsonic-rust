import assert from "node:assert/strict";
import test from "node:test";
import { selectRustValueCarrierReconciliation } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { selectRustCallableValueAdapter } from "../../../dist/analysis/callables/adapters.js";
import { recordRustValueCarrierReconciliation, rustEffectiveValueCarrier } from "../../../dist/analysis/facts/value-carrier-queries.js";
import { rustProjectUpcastFactKey, rustContextualValueConversionFactKey } from "../../../dist/analysis/facts/keys.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";

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

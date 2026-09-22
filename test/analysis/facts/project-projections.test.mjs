import assert from "node:assert/strict";
import test from "node:test";
import { createRustPlanBuilder } from "../../../dist/analysis/facts/plan-store.js";
import {
  rustFlowReadProjectionFactKey,
  rustProjectDowncastFactKey,
  rustSelectedProjectDowncast,
} from "../../../dist/analysis/facts/value-projections.js";

const sourceCarrier = { kind: "target-named", id: "source" };
const dispatchCarrier = { kind: "target-named", id: "dispatch" };
const targetCarrier = { kind: "target-named", id: "target" };
const selection = { sourceCarrier, dispatchCarrier, targetCarrier };

function model() {
  return createRustPlanBuilder({ getFact: () => undefined });
}

test("project planning consumes exact sealed cast or flow evidence", () => {
  for (const mode of ["cast", "flow", "both"]) {
    const facts = model();
    const node = {};
    if (mode !== "flow") facts.set(node, rustProjectDowncastFactKey, selection);
    if (mode !== "cast") facts.set(node, rustFlowReadProjectionFactKey, {
      kind: "project-downcast", sourceCarrier, dispatchCarrier,
      selectedCarrier: targetCarrier,
    });
    assert.deepEqual(rustSelectedProjectDowncast(facts, node), selection);
    assert.equal(rustSelectedProjectDowncast(facts, {}), undefined);
  }
});

test("contradictory projection evidence cannot be replanned as a valid cast", () => {
  for (const field of ["sourceCarrier", "dispatchCarrier", "selectedCarrier"]) {
    const facts = model();
    const node = {};
    facts.set(node, rustProjectDowncastFactKey, selection);
    facts.set(node, rustFlowReadProjectionFactKey, {
      kind: "project-downcast", sourceCarrier, dispatchCarrier,
      selectedCarrier: targetCarrier,
      [field]: { kind: "target-named", id: "different" },
    });
    assert.equal(rustSelectedProjectDowncast(facts, node), undefined);
  }
});

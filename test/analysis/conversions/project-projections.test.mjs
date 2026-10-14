import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";

import { rustSelectedProjectDowncast } from "../../../dist/analysis/control-flow/project-downcasts.js";

const sourceCarrier = { kind: "target-named", id: "source" };
const dispatchCarrier = { kind: "target-named", id: "dispatch" };
const targetCarrier = { kind: "target-named", id: "target" };
const projection = { kind: "closed", slot: "selected_view" };
const selection = { sourceCarrier, dispatchCarrier, targetCarrier, projection };

function model() {
  return createRustProgramRecordBuilder();
}

test("project planning consumes exact sealed cast or flow evidence", () => {
  for (const mode of ["cast", "flow", "both"]) {
    const records = model();
    const node = {};
    if (mode !== "flow") records.projectDowncasts.project(node, sourceCarrier, dispatchCarrier, targetCarrier, projection);
    if (mode !== "cast") records.flowReadProjection.set(node, {
      kind: "project-downcast", sourceCarrier, dispatchCarrier,
      selectedCarrier: targetCarrier, projection,
    });
    assert.deepEqual(rustSelectedProjectDowncast(records, node), selection);
    assert.equal(rustSelectedProjectDowncast(records, {}), undefined);
  }
});

test("contradictory projection evidence cannot be replanned as a valid cast", () => {
  for (const field of ["sourceCarrier", "dispatchCarrier", "selectedCarrier"]) {
    const records = model();
    const node = {};
    records.projectDowncasts.project(node, sourceCarrier, dispatchCarrier, targetCarrier, projection);
    records.flowReadProjection.set(node, {
      kind: "project-downcast", sourceCarrier, dispatchCarrier,
      selectedCarrier: targetCarrier, projection,
      [field]: { kind: "target-named", id: "different" },
    });
    assert.equal(rustSelectedProjectDowncast(records, node), undefined);
  }
});

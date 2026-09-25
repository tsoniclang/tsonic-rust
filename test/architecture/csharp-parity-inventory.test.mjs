import { test } from "node:test";
import assert from "node:assert/strict";
import { readTargetParityInventory, targetReferenceFindings } from "../../../tsonic/test/architecture/tooling/target-parity-inventory.mjs";

const lanes = readTargetParityInventory("language-lanes");
const classifications = new Set([
  "implemented",
  "implementation-gap",
  "contract-gap",
  "target-limit",
  "shared-rejection",
]);

test("C# parity inventory is complete and mechanically classified", () => {
  assert.ok(lanes.length >= 45, `parity inventory is too small: ${lanes.length}`);
  const identities = new Set();
  const areas = new Set();
  for (const lane of lanes) {
    assert.equal(typeof lane.id, "string");
    assert.ok(!identities.has(lane.id), `duplicate parity lane '${lane.id}'`);
    identities.add(lane.id);
    areas.add(lane.area);
    assert.ok(classifications.has(lane.classification), lane.id);
    assert.equal(typeof lane.source, "string", `${lane.id} needs source`);
    assert.ok(lane.source.length > 0, `${lane.id} has empty source`);
    assert.equal(typeof lane.rustReference, "string", `${lane.id} needs a Rust source reference`);
    assert.equal(typeof lane.action, "string", `${lane.id} needs an action`);
    assert.ok(lane.action.length > 0, `${lane.id} has no action`);
  }
  for (const area of [
    "modules",
    "declarations",
    "objects",
    "control-flow",
    "iteration",
    "generators",
    "resources",
    "expressions",
    "types",
    "safety",
    "providers",
    "surfaces",
    "output",
  ]) {
    assert.ok(areas.has(area), `missing parity area '${area}'`);
  }
});

test("priority coverage remains mechanically visible", () => {
  for (const laneId of [
    "modules.default-expression-export",
    "declarations.class-static-blocks",
    "objects.spread",
    "declarations.generic-virtual-methods",
    "providers.standard-library-breadth",
    "js-node.detailed-surface",
  ]) {
    const lane = lanes.find(({ id }) => id === laneId);
    assert.ok(lane !== undefined, `missing prioritized lane '${laneId}'`);
    assert.ok(
      classifications.has(lane.classification),
      `priority lane '${laneId}' has no valid closure`,
    );
  }
});

test("the detailed JS and Node inventory remains a required parity input", () => {
  const detailed = readTargetParityInventory("javascript-node-lanes");
  assert.ok(detailed.length >= 140, `detailed surface inventory is too small: ${detailed.length}`);
});

test("shared C#/Rust structural references resolve without claiming behavioral parity", () => {
  assert.deepEqual(targetReferenceFindings(lanes), []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const document = readFileSync(join(root, "docs/csharp-parity.md"), "utf8");
const lanes = JSON.parse(readFileSync(
  join(root, "docs/csharp-parity-lanes.json"),
  "utf8",
));
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
    assert.equal(typeof lane.rustProof, "string", `${lane.id} needs Rust evidence`);
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

test("every open implementation lane and priority closure remains visible", () => {
  const open = lanes.filter(({ classification }) =>
    classification === "implementation-gap" || classification === "contract-gap");
  assert.ok(open.length > 0, "the inventory must not silently claim complete parity");
  for (const classification of new Set(open.map((lane) => lane.classification))) {
    assert.ok(document.includes(`\`${classification}\``), classification);
  }
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
      lane.classification === "implemented" || open.includes(lane),
      `priority lane '${laneId}' has no implemented or open closure`,
    );
  }
});

test("the detailed JS and Node inventory remains a required parity input", () => {
  assert.match(document, /docs\/parity-lanes\.json/u);
  const detailed = JSON.parse(readFileSync(join(root, "docs/parity-lanes.json"), "utf8"));
  assert.ok(detailed.length >= 140, `detailed surface inventory is too small: ${detailed.length}`);
});

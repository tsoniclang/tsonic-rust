import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jsOperationRows } from "../../dist/policy/operations/source-profiles/js/rows.js";
import { readTargetParityInventory } from "../../../tsonic/test/architecture/tooling/target-parity-inventory.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const operationTableRoot = join(root, "src/policy/operations/source-profiles/js");
const operationTables = readdirSync(operationTableRoot)
  .filter((name) => name === "rows.ts" || name.endsWith("-rows.ts"))
  .sort()
  .map((name) => readFileSync(join(operationTableRoot, name), "utf8"))
  .join("\n");
const operationMembers = new Set(jsOperationRows.map((row) => row.member));

test("implemented row members exist in the operation tables", () => {
  const members = ["findLastIndex", "symmetricDifference", "isDisjointFrom", "matchAll", "exec", "lastIndex", "toJSON", "parse", "UTC", "parseInt", "toFixed"];
  for (const member of members) {
    assert.ok(operationMembers.has(member), member);
  }
});

const lanes = readTargetParityInventory("javascript-node-lanes");

test("implemented lanes with row members exist in the operation tables", () => {
  for (const lane of lanes) {
    if (lane.classification !== "implemented") {
      continue;
    }
    if (lane.rowMember !== undefined) {
      assert.ok(operationMembers.has(lane.rowMember), `${lane.lane}: no row for member ${lane.rowMember}`);
    }
    if (lane.rowFactory !== undefined) {
      assert.ok(operationTables.includes(`function ${lane.rowFactory}(`), `${lane.lane}: no row factory ${lane.rowFactory}`);
    }
  }
});

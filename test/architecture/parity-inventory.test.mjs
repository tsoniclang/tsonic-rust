import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const inventory = readFileSync(join(root, "docs/parity-inventory.md"), "utf8");
const rows = readFileSync(join(root, "src/policy/operations/js-surface/rows.ts"), "utf8");

test("inventory wording is timeless", () => {
  for (const banned of [/\bcurrently\b/iu, /\bpending\b/iu, /\bfuture\b/iu, /\blater\b/iu, /\bR1[0-9]\b/u, /\bslice label\b|\bnext slice\b/iu]) {
    assert.ok(!banned.test(inventory), String(banned));
  }
});

test("implemented row members exist in the operation tables", () => {
  const members = ["findLastIndex", "symmetricDifference", "isDisjointFrom", "matchAll", "exec", "lastIndex", "toJSON", "parse", "UTC", "parseInt", "toFixed"];
  for (const member of members) {
    assert.ok(rows.includes(`member: "${member}"`), member);
  }
});

test("target limits each state their exact boundary", () => {
  const targetLimits = inventory.split("## Target limits")[1];
  const entries = targetLimits.split("\n- ").slice(1);
  assert.ok(entries.length >= 4);
  for (const entry of entries) {
    assert.match(entry, /cannot|has no|omits|without/u, entry.slice(0, 60));
  }
});

const lanes = JSON.parse(readFileSync(join(root, "docs/parity-lanes.json"), "utf8"));

test("every C#-relative lane has exactly one valid classification", () => {
  assert.ok(lanes.length >= 90, `lane list too small: ${lanes.length}`);
  const seen = new Set();
  for (const lane of lanes) {
    assert.ok(["implemented", "hard-rejected", "target-limit"].includes(lane.classification), lane.lane);
    assert.ok(!seen.has(lane.lane), `duplicate lane: ${lane.lane}`);
    seen.add(lane.lane);
    if (lane.classification === "target-limit") {
      assert.ok(typeof lane.reason === "string" && lane.reason.length >= 40, `${lane.lane} must state its exact target boundary`);
    }
  }
});

test("the C# surface families cannot silently disappear from the inventory", () => {
  const requiredFamilies = [
    "Object.keys", "Object.assign", "Object.hasOwn",
    "Number.parseInt", "Number.isNaN", "toFixed",
    "console.log", "node:assert", "bare module aliases",
    "process identity and metrics", "process stdio", "buffer extras",
    "local-time getters", "UTC setters",
    "localeCompare", "matchAll result consumption", "exec/match result consumption",
    "streams and fs.watch", "discriminated object unions",
  ];
  for (const family of requiredFamilies) {
    assert.ok(lanes.some((lane) => lane.lane.includes(family)), `missing lane family: ${family}`);
    assert.ok(inventory.includes(family.split("/")[0].split(" (")[0]), `inventory prose missing: ${family}`);
  }
});

test("implemented lanes with row members exist in the operation tables", () => {
  for (const lane of lanes) {
    if (lane.classification !== "implemented") {
      continue;
    }
    if (lane.rowMember !== undefined) {
      assert.ok(rows.includes(`member: "${lane.rowMember}"`), `${lane.lane}: no row for member ${lane.rowMember}`);
    }
    if (lane.rowFactory !== undefined) {
      assert.ok(rows.includes(`function ${lane.rowFactory}(`), `${lane.lane}: no row factory ${lane.rowFactory}`);
    }
  }
});

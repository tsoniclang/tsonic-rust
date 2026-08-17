import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = readFileSync(join(root, "docs/parity-inventory.md"), "utf8");
const rows = readFileSync(join(root, "src/source/rust-target-semantics/js-surface-operations.ts"), "utf8");

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

test("blocked entries each name a contract", () => {
  const blocked = inventory.split("## Blocked by named external contracts")[1];
  const entries = blocked.split("\n- ").slice(1);
  assert.ok(entries.length >= 4);
  for (const entry of entries) {
    assert.match(entry, /requires/u, entry.slice(0, 40));
  }
});

const lanes = JSON.parse(readFileSync(join(root, "docs/parity-lanes.json"), "utf8"));

test("every C#-relative lane has exactly one valid classification", () => {
  assert.ok(lanes.length >= 90, `lane list too small: ${lanes.length}`);
  const seen = new Set();
  for (const lane of lanes) {
    assert.ok(["implemented", "hard-rejected", "blocked"].includes(lane.classification), lane.lane);
    assert.ok(!seen.has(lane.lane), `duplicate lane: ${lane.lane}`);
    seen.add(lane.lane);
    if (lane.classification === "blocked") {
      assert.ok(typeof lane.contract === "string" && lane.contract.startsWith("requires"), `${lane.lane} must name its contract`);
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
    if (lane.classification !== "implemented" || lane.rowMember === undefined) {
      continue;
    }
    assert.ok(rows.includes(`member: "${lane.rowMember}"`), `${lane.lane}: no row for member ${lane.rowMember}`);
  }
});

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
  const members = ["findLastIndex", "symmetricDifference", "isDisjointFrom", "matchAll", "exec", "lastIndex", "toJSON", "parse", "UTC"];
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  closedMetadataEquals,
  closedMetadataKey,
  hasExactObjectKeys,
  isClosedMetadata,
  isDenseDataArray,
  materializeClosedMetadata,
  snapshotClosedMetadata,
} from "../../../dist/target-model/metadata/closed-data.js";

test("closed metadata is plain finite data: records, dense arrays, strings, booleans, bigints and finite numbers", () => {
  assert.equal(isClosedMetadata({ id: "acme", width: 8, signed: true, max: 255n, rows: [1, "two", null, undefined] }), true);
  assert.equal(isClosedMetadata(Object.assign(Object.create(null), { id: "acme" })), true);
  assert.equal(isClosedMetadata({ value: Number.NaN }), false);
  assert.equal(isClosedMetadata({ value: Number.POSITIVE_INFINITY }), false);
  assert.equal(isClosedMetadata({ value: () => 1 }), false);
  assert.equal(isClosedMetadata(new Map()), false);
  assert.equal(isClosedMetadata({ get value() { return 1; } }), false);
  assert.equal(isClosedMetadata({ [Symbol("key")]: 1 }), false);
  const sparse = [1];
  sparse[2] = 3;
  assert.equal(isClosedMetadata(sparse), false);
  const cyclic = { id: "loop" };
  cyclic.self = cyclic;
  assert.equal(isClosedMetadata(cyclic), false);
});

test("closed metadata equality and identity keys ignore field order and distinguish value kinds", () => {
  assert.equal(closedMetadataEquals({ a: 1, b: ["x"] }, { b: ["x"], a: 1 }), true);
  assert.equal(closedMetadataEquals({ a: 1 }, { a: 1n }), false);
  assert.equal(closedMetadataEquals([1, 2], [1, 2, 3]), false);
  assert.equal(closedMetadataEquals({ value: Number.NaN }, { value: Number.NaN }), false, "non-closed values never compare equal");
  assert.equal(closedMetadataKey({ b: 2, a: "x" }), closedMetadataKey({ a: "x", b: 2 }));
  assert.notEqual(closedMetadataKey({ a: 1 }), closedMetadataKey({ a: "1" }));
  assert.notEqual(closedMetadataKey({ a: 1 }), closedMetadataKey({ a: 1n }));
  assert.equal(closedMetadataKey(["ab", "c"]) === closedMetadataKey(["a", "bc"]), false, "string keys carry their length");
  assert.throws(() => closedMetadataKey({ value: () => 1 }), /non-closed metadata/u);
});

test("snapshots are frozen deep copies; materialized copies stay mutable; invalid input is refused with its path", () => {
  const source = { id: "acme", rows: [{ width: 8 }] };
  const snapshot = snapshotClosedMetadata(source);
  assert.notEqual(snapshot, source);
  assert.deepEqual(snapshot, source);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.rows), true);
  assert.equal(Object.isFrozen(snapshot.rows[0]), true);
  const materialized = materializeClosedMetadata(snapshot);
  assert.equal(Object.isFrozen(materialized), false);
  assert.equal(Object.isFrozen(materialized.rows[0]), false);
  assert.throws(() => snapshotClosedMetadata({ rows: [{ value: Number.NaN }] }), /metadata\.rows\[0\]\.value contains a non-finite number/u);
  const cyclic = { id: "loop" };
  cyclic.self = cyclic;
  assert.throws(() => snapshotClosedMetadata(cyclic), /metadata\.self contains a cycle/u);
});

test("dense arrays and exact record keys are checked by own data properties only", () => {
  assert.equal(isDenseDataArray([1, 2]), true);
  const extra = [1];
  extra.label = "x";
  assert.equal(isDenseDataArray(extra), false);
  assert.equal(hasExactObjectKeys({ id: "a", width: 1 }, ["width", "id"]), true);
  assert.equal(hasExactObjectKeys({ id: "a" }, ["id", "width"]), false);
  assert.equal(hasExactObjectKeys({ get id() { return "a"; } }, ["id"]), false);
});

test("provider metadata is target-model vocabulary: the semantics contract is a declaration, not behaviour", () => {
  const owner = readFileSync(new URL("../../../src/target-model/metadata/provider-metadata.ts", import.meta.url), "utf8");
  assert.equal(owner.includes("export interface RustProviderSemantics"), true);
  assert.equal(/export\s+function\b/u.test(owner), false, "provider metadata declares types only");
});

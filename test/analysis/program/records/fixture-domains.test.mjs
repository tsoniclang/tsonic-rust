import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../../helpers/records.mjs";

test("record fixtures retain the complete raw analysis domain when no base is supplied", () => {
  const records = createRustRecordFixture();
  assert.equal(Object.keys(records).length, 348, "the complete current raw analysis family domain");
  assert.equal(typeof records.typedLocationPlan.get, "function", "the raw source producer remains available");
});

test("record fixtures preserve a supplied backend domain without inventing removed raw readers", () => {
  const subject = {};
  const original = {};
  const replacement = {};
  const base = Object.freeze({
    nativeHandler: Object.freeze({ get: () => undefined }),
    targetOperation: Object.freeze({ get: selected => selected === subject ? original : undefined }),
  });
  const records = createRustRecordFixture({ targetOperation: { get: selected => selected === subject ? replacement : undefined } }, base);
  assert.equal(Object.keys(records).length, 2, "the backend fixture has exactly its actual two-family domain");
  assert.equal(Object.hasOwn(records, "typedLocationPlan"), false, "no removed raw reader is fabricated");
  assert.equal(records.targetOperation.get(subject) === replacement, true, "the exact mutation reaches its owner");
  assert.equal(base.targetOperation.get(subject) === original, true, "the original supplied facts remain unchanged");
});

test("record fixtures refuse an override outside the supplied domain", () => {
  const base = Object.freeze({ targetOperation: Object.freeze({ get: () => undefined }) });
  assert.throws(() => createRustRecordFixture({ typedLocationPlan: { get: () => undefined } }, base),
    /Unknown Rust record family: typedLocationPlan/u, "a raw reader cannot be smuggled into the backend domain");
});

test("record fixtures still reject missing readers in the supplied domain", () => {
  assert.throws(() => createRustRecordFixture({}, { targetOperation: undefined }),
    /Missing Rust record reader: targetOperation/u, "domain preservation never substitutes a missing reader");
});

test("record fixtures retain the canonical shared literal reader without inspecting foreign properties", () => {
  const subject = {};
  const literal = Object.freeze({ kind: "integer", value: 1n });
  let foreignReads = 0;
  const base = { literalValue: Object.freeze({ get: node => node === subject ? literal : undefined }) };
  Object.defineProperty(base, "foreign", { enumerable: true, get() { foreignReads += 1; throw new Error("foreign reader"); } });
  const records = createRustRecordFixture({}, base);
  assert.equal(records.literalValue.get(subject) === literal, true, "the exact canonical shared literal survives");
  assert.equal(Object.keys(records).length, 1, "only the supplied canonical family is projected");
  assert.equal(foreignReads, 0, "unrelated properties are never read");
  assert.equal(Object.isFrozen(records.literalValue), true, "the shared reader is immutable");
});

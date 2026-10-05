import assert from "node:assert/strict";
import test from "node:test";
import { rustClosureCaptureFactKey } from "../../../dist/analysis/facts/operations/keys.js";
import { rustCapturedFieldStorageFactKey } from "../../../dist/analysis/facts/receiver-captures.js";
import { stringCarrier } from "../../helpers/rust-session.mjs";

const declaration = {};
const reference = {};
const receiver = {};
const field = { declaration, reference, receiver, references: [reference], carrier: stringCarrier,
  storage: { kind: "borrow-cell", initialization: "deferred" } };
const fact = { captures: [], receiverFields: [field] };

test("live receiver facts retain exact source identities, membership and physical storage", () => {
  assert.equal(rustClosureCaptureFactKey.equals(fact, { captures: [], receiverFields: [{ ...field }] }), true);
  for (const changed of [
    { ...field, declaration: {} }, { ...field, reference: {} }, { ...field, receiver: {} },
    { ...field, references: [] }, { ...field, references: [reference, {}] }, { ...field, references: [, reference] },
    { ...field, storage: { ...field.storage, initialization: "ready" } },
    { ...field, storage: { ...field.storage, kind: "cell" } },
    { ...field, storage: { ...field.storage, unchecked: true } }, { ...field, unrelated: true },
  ]) assert.equal(rustClosureCaptureFactKey.equals(fact, { captures: [], receiverFields: [changed] }), false);
  assert.equal(rustClosureCaptureFactKey.equals(fact, { captures: [] }), false);
  assert.equal(rustClosureCaptureFactKey.equals(fact, { ...fact, unrelated: true }), false);
});

test("capture metadata rejects accessors without evaluating them", () => {
  let reads = 0;
  const changed = { ...field };
  Object.defineProperty(changed, "storage", { get() { reads++; return field.storage; }, enumerable: true });
  assert.equal(rustClosureCaptureFactKey.equals(fact, { captures: [], receiverFields: [changed] }), false);
  assert.equal(reads, 0);
});

test("field storage facts reject missing, invalid and competing carrier representations", () => {
  const storage = { storage: field.storage, valueCarrier: stringCarrier };
  assert.equal(rustCapturedFieldStorageFactKey.equals(storage, { ...storage }), true);
  for (const changed of [{ ...storage, extra: true }, { ...storage, valueCarrier: undefined },
    { ...storage, storage: { kind: "borrow-cell", initialization: "unchecked" } },
    { ...storage, storage: { ...field.storage, extra: true } }])
    assert.equal(rustCapturedFieldStorageFactKey.equals(storage, changed), false);
});

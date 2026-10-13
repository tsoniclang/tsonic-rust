import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "./records.mjs";

test("record fixtures accept named families and reject superseded native-key interception APIs", () => {
  const subject = {};
  const value = { carrier: { kind: "source-primitive", name: "int32" } };
  const records = createRustRecordFixture({ runtimeCarrier: { get: node => node === subject ? value : undefined } });
  assert.equal(records.runtimeCarrier.get(subject) === value, true, "exact family and source identity");
  assert.equal(records.runtimeCarrier.get({}) === undefined, true, "foreign subject");
  assert.equal(records.targetOperation.get(subject) === undefined, true, "another family cannot inherit the value");
  for (const removed of ["get", "getFact", "resolve", "set", "getRuntimeCarrierFact", "getSelectedTargetCall"]) {
    assert.throws(() => createRustRecordFixture({ [removed]: () => undefined }), /Unknown Rust record family/u, removed);
  }
});

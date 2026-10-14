import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";

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

test("record fixture overlays project only the declared immutable reader port", () => {
  const subject = {};
  const selected = { carrier: { kind: "source-primitive", name: "int32" } };
  const builder = createRustProgramRecordBuilder();
  builder.runtimeCarriers.selected(subject, selected.carrier);
  const admitted = builder.runtimeCarrier.get(subject);
  let foreignReads = 0;
  const base = { ...builder };
  Object.defineProperty(base, "foreign", { enumerable: true, get() { foreignReads += 1; throw new Error("foreign reader"); } });
  const records = createRustRecordFixture({ targetOperation: { get: () => undefined } }, base);
  assert.equal(records.runtimeCarrier.get(subject) === admitted, true, "the existing exact source value survives");
  assert.equal(records.targetOperation.get(subject) === undefined, true, "the selected override is retained");
  assert.equal(records.minimumFoundation === undefined, true, "analysis configuration is not a record family");
  assert.equal(records.runtimeCarrier.set === undefined, true, "writer capabilities cannot leak through a family");
  assert.equal(Object.isFrozen(records.runtimeCarrier), true, "the reader family is immutable");
  assert.equal(foreignReads, 0, "the base's unrelated properties are never inspected");
  assert.throws(() => createRustRecordFixture({ minimumFoundation: () => "core" }, base), /Unknown Rust record family/u);
  assert.throws(() => createRustRecordFixture({ runtimeCarrier: undefined }, base), /Missing Rust record reader/u);
  assert.throws(() => createRustRecordFixture({}, {}), /Missing Rust record reader/u);
});

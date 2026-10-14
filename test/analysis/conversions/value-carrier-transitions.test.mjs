import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustValueCarrierTransitionTarget } from "../../../dist/analysis/conversions/value-carrier-queries.js";

import { rustStringTargetType, rustBorrowedStrTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";

test("source transitions retain an exact already-projected input before contextual borrowing", () => {
  const value = rustStringTargetType();
  const raw = rustOptionTargetType(value);
  const target = rustBorrowedStrTargetType();
  const flow = { kind: "option-value", sourceCarrier: raw, selectedCarrier: value };
  const selectedConversion = selectRustSourceValueConversion(value, target);
  assert.equal(selectedConversion !== undefined, true);
  const conversion = { sourceCarrier: value, targetCarrier: target, conversion: selectedConversion };
  const records = createRustRecordFixture({flowReadProjection: { get: (_subject) => flow },
contextualValueConversion: { get: (_subject) => conversion },
runtimeCarrier: { get: () => ({ carrier: raw }) },
conversion: { get: () => undefined }});
  const subject = {};
  assert.equal(rustValueCarrierTransitionTarget(records, subject, raw) === target, true);
  assert.equal(rustValueCarrierTransitionTarget(records, subject, value) === target, true);
  assert.equal(rustValueCarrierTransitionTarget(records, subject, target) === undefined, true);
  assert.equal(rustValueCarrierTransitionTarget(records, subject, { kind: "source-primitive", name: "int32" }) === undefined, true);
  const unprojected = createRustRecordFixture({
    flowReadProjection: { get: () => undefined },
    contextualValueConversion: { get: () => conversion },
  }, records);
  assert.equal(unprojected.flowReadProjection.get(subject) === undefined, true, "the adverse fixture removes its actual projection");
  assert.equal(rustValueCarrierTransitionTarget(unprojected, subject, value) === undefined, true);
});

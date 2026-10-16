import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion, rustValueCarrierTransitionTarget } from "../../../dist/analysis/conversions/value-carrier-queries.js";

import { rustStringTargetType, rustBorrowedStrTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustKnownNumericValueConversion, selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";

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

test("checked float64 transitions preserve source storage and select one native float32 conversion", () => {
  const source = rustSourcePrimitiveTargetType("float64");
  const target = rustSourcePrimitiveTargetType("float32");
  for (const value of [1.0000000596046448, 1e40, -1e40, -0]) {
    const conversion = selectRustKnownNumericValueConversion(source, target,
      { form: "numeric", numeric: { kind: "checked-float64", value } });
    assert.equal(conversion?.id === "native-f64-to-f32", true, `${value}: native cast selected`);
    const records = createRustRecordFixture({ runtimeCarrier: { get: () => ({ carrier: source }) },
      conversion: { get: () => undefined },
      contextualValueConversion: { get: () => ({ sourceCarrier: source, targetCarrier: target, conversion }) } });
    const subject = {};
    assert.equal(rustValueCarrierBeforeContextualConversion(records, subject) === source, true, "source stays f64");
    assert.equal(rustEffectiveValueCarrier(records, subject) === target, true, "selected value is f32");
    assert.equal(rustValueCarrierTransitionTarget(records, subject) === target, true, "one canonical transition");
    assert.equal(rustValueCarrierTransitionTarget(records, subject, target) === undefined, true, "no second conversion");
  }
});

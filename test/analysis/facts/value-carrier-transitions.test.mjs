import assert from "node:assert/strict";
import test from "node:test";
import { rustValueCarrierTransitionTarget } from "../../../dist/analysis/facts/value-carrier-queries.js";
import { rustFlowReadProjectionFactKey, rustContextualValueConversionFactKey } from "../../../dist/analysis/facts/keys.js";
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
  const facts = {
    getRuntimeCarrierFact: () => ({ carrier: raw }),
    getTargetConversionFact: () => undefined,
    getFact: (_subject, key) => key === rustFlowReadProjectionFactKey ? flow
      : key === rustContextualValueConversionFactKey ? conversion : undefined,
  };
  const subject = {};
  assert.equal(rustValueCarrierTransitionTarget(facts, subject, raw) === target, true);
  assert.equal(rustValueCarrierTransitionTarget(facts, subject, value) === target, true);
  assert.equal(rustValueCarrierTransitionTarget(facts, subject, target) === undefined, true);
  assert.equal(rustValueCarrierTransitionTarget(facts, subject, { kind: "source-primitive", name: "int32" }) === undefined, true);
  const unprojected = { ...facts, getFact: (_subject, key) => key === rustContextualValueConversionFactKey ? conversion : undefined };
  assert.equal(rustValueCarrierTransitionTarget(unprojected, subject, value) === undefined, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { rustBorrowedStrTargetType, rustStrTargetType, rustStringTargetType,
  rustSourceOptionalTargetType } from "../../dist/target-model/types/index.js";
import { rustValueConversionContract } from "../../dist/target-model/conversions/contracts.js";
import { finalizeValueConversion, finalizedConversionIsValid } from "../../dist/analysis/facts/finalized-operation/conversions.js";

test("owned, borrowed and optional string conversions share the exact native str carrier", () => {
  const string = rustStringTargetType();
  const borrowed = { kind: "reference", referent: rustStrTargetType(), mutable: false };
  const stringReference = { kind: "reference", referent: string, mutable: false };
  assert.deepEqual(rustBorrowedStrTargetType(), borrowed);
  assert.notDeepEqual(borrowed, stringReference);
  for (const [id, source, target, mode] of [
    ["borrowed-str-from-owned-string", string, borrowed, "ref"],
    ["owned-string-from-borrowed-str", borrowed, string, "value"],
    ["borrowed-str-from-optional-string", rustSourceOptionalTargetType(string), borrowed, "ref"],
  ]) {
    const conversion = { kind: "semantic-conversion", id };
    const contract = rustValueConversionContract(conversion);
    assert.deepEqual(contract.source, source, id);
    assert.deepEqual(contract.target, target, id);
    assert.equal(contract.sourceMode, mode, id);
    assert.equal(contract.fallible, false, id);
    const fact = finalizeValueConversion(conversion, source, target);
    assert.equal(finalizedConversionIsValid(fact), true, id);
    assert.equal(finalizedConversionIsValid({ ...fact, fallible: true }), false, id);
    if (source === borrowed) {
      assert.equal(finalizeValueConversion(conversion, stringReference, target), undefined, id);
    } else {
      assert.equal(finalizeValueConversion(conversion, source, stringReference), undefined, id);
    }
  }
});

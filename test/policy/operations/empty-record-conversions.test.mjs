import assert from "node:assert/strict";
import test from "node:test";
import { rustEmptyRecordCarrier, rustEmptyRecordConversionMatches } from "../../../dist/target-model/conversions/empty-record.js";
import { rustEmptyObjectTargetType, rustObjectIdentityTargetType, rustJsValueTargetType, rustStructuralObjectTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";

test("empty-record transitions retain exact carriers and exclude data-bearing or reference records", () => {
  const object = rustEmptyObjectTargetType();
  const value = rustStructuralObjectTargetType("/src/schema.ts", [], "value");
  const conversion = { kind: "empty-record", source: value, target: object };
  assert.equal(rustEmptyRecordConversionMatches(conversion, value, object), true);
  assert.equal(rustEmptyRecordConversionMatches(conversion, object, value), false);
  assert.equal(rustEmptyRecordConversionMatches({ ...conversion, target: value }, value, value), false);
  for (const type of [rustSourcePrimitiveTargetType("float64"),
    { ...object, typeArguments: [rustSourcePrimitiveTargetType("float64")] },
    rustStructuralObjectTargetType("/src/schema.ts", [], "reference"),
    rustStructuralObjectTargetType("/src/schema.ts", [{ sourceName: "count", type: rustSourcePrimitiveTargetType("int32"),
      presence: "required", readonly: false }], "value")]) {
    assert.equal(rustEmptyRecordCarrier(type), false);
    assert.equal(rustEmptyRecordConversionMatches({ ...conversion, source: type }, type, object), false);
  }
});

test("opaque identity transport never proves a closed object projection", () => {
  const empty = rustEmptyObjectTargetType();
  const identity = rustObjectIdentityTargetType();
  assert.equal(rustEmptyRecordCarrier(identity), false);
  assert.deepEqual(selectRustSourceValueConversion(empty, identity), {
    kind: "semantic-conversion", id: "object-identity-from-empty",
  });
  assert.equal(selectRustSourceValueConversion(identity, empty), undefined);
  assert.equal(selectRustSourceValueConversion(identity, rustJsValueTargetType()), undefined);
  assert.equal(selectRustSourceValueConversion(empty, rustJsValueTargetType())?.kind, "js-value-from-closed-carrier");
});

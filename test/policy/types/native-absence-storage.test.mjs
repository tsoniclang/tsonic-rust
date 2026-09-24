import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceOptionalTargetType, rustOptionalStorageProjection } from "../../../dist/target-model/types/projections.js";
import { substituteRustTargetTypeParameters, rustOptionTargetType, rustAbsenceTargetType, rustJsValueTargetType,
  rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("source absence normalization retains one native layer and genuine native options", () => {
  const value = rustSourcePrimitiveTargetType("int64");
  const optional = rustSourceOptionalTargetType(value);
  assert.deepEqual(rustSourceOptionalTargetType(optional), optional);
  assert.deepEqual(rustSourceOptionalTargetType(rustAbsenceTargetType()), rustAbsenceTargetType());
  assert.deepEqual(rustSourceOptionalTargetType(rustJsValueTargetType()), rustJsValueTargetType());
  assert.deepEqual(rustSourceOptionalTargetType(rustOptionTargetType(value)).genericArguments,
    [{ kind: "type", type: rustOptionTargetType(value) }]);
  assert.equal(rustTargetTypeRefEquals(optional, rustOptionTargetType(value)), true);
});

test("generic storage substitution is exact for values, nullable values and pure absence", () => {
  const value = rustSourcePrimitiveTargetType("int64");
  const parameter = { kind: "type-parameter", name: "Value" };
  const projection = rustSourceOptionalTargetType(parameter);
  assert.deepEqual(projection, rustOptionalStorageProjection(parameter));
  for (const argument of [value, rustSourceOptionalTargetType(value), rustAbsenceTargetType(), rustJsValueTargetType()]) {
    assert.deepEqual(substituteRustTargetTypeParameters(projection, new Map([["Value", argument]])), rustSourceOptionalTargetType(argument));
  }
  const array = { kind: "array", element: projection };
  assert.deepEqual(substituteRustTargetTypeParameters(array, new Map([["Value", rustSourceOptionalTargetType(value)]])),
    { kind: "array", element: rustSourceOptionalTargetType(value) });
});

test("native absence metadata rejects malformed carrier claims", () => {
  const value = rustSourcePrimitiveTargetType("int64");
  assert.equal(isRustTargetTypeRef(rustSourceOptionalTargetType(value)), true);
  assert.equal(isRustTargetTypeRef({ ...value, sourceAbsence: true }), false);
  assert.equal(isRustTargetTypeRef({ kind: "target-named", id: "other", sourceAbsence: true }), false);
  assert.equal(isRustTargetTypeRef({ kind: "target-named", id: "rust.std.Option", sourceAbsence: true }), false);
  assert.equal(isRustTargetTypeRef({ kind: "target-named", id: "rust.std.Option", sourceAbsence: true,
    genericArguments: [{ kind: "type", type: value }, { kind: "type", type: value }] }), false);
  assert.equal(isRustTargetTypeRef({ kind: "type-parameter", name: "Value", optionalStorageValue: {} }), false);
});

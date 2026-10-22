import assert from "node:assert/strict";
import test from "node:test";
import {
  isRustJsStrictEqualityCarrier,
  rustCarrierHasNativeValueView,
  rustCarrierSupportsJsEquality,
  rustCarrierSupportsObjectIdentity,
} from "../../../../dist/policy/operations/js-values/carrier-protocols.js";
import {
  rustJsMapTargetType,
  rustJsValueTargetType,
} from "../../../../dist/target-model/types/carriers/js.js";
import {
  rustAbsenceTargetType,
  rustNamedTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../../dist/target-model/types/carriers/native.js";
import {
  rustJsSymbolTargetId,
  rustTsValueTargetId,
} from "../../../../dist/target-model/types/carriers/source-types.js";

const float64 = rustSourcePrimitiveTargetType("float64");
const map = rustJsMapTargetType(rustStringTargetType(), float64);
const symbol = { kind: "target-named", id: rustJsSymbolTargetId };
const tsValue = { kind: "target-named", id: rustTsValueTargetId };
const userType = rustNamedTargetType("acme.Widget", "acme::Widget");

test("JS strict equality is admitted only for the closed set of JS runtime carriers", () => {
  assert.equal(isRustJsStrictEqualityCarrier(map), true);
  assert.equal(isRustJsStrictEqualityCarrier(symbol), true);
  assert.equal(isRustJsStrictEqualityCarrier(float64), false);
  assert.equal(isRustJsStrictEqualityCarrier(userType), false);
  assert.equal(isRustJsStrictEqualityCarrier(undefined), false);
});

test("JS equality protocols are selected from the exact carrier, not from the operator", () => {
  for (const carrier of [float64, rustStringTargetType(), rustAbsenceTargetType(), map, symbol]) {
    assert.equal(rustCarrierSupportsJsEquality(carrier), true, JSON.stringify(carrier));
  }
  assert.equal(rustCarrierSupportsJsEquality(userType), false);
  assert.equal(rustCarrierSupportsJsEquality(undefined), false);
});

test("native value views exist only for scalar, string, absence and TsValue carriers", () => {
  for (const carrier of [float64, rustStringTargetType(), rustAbsenceTargetType(), tsValue]) {
    assert.equal(rustCarrierHasNativeValueView(carrier), true, JSON.stringify(carrier));
  }
  assert.equal(rustCarrierHasNativeValueView(map), false);
  assert.equal(rustCarrierHasNativeValueView(rustJsValueTargetType()), false);
});

test("object identity is a JS runtime object property; symbols compare by value without object identity", () => {
  assert.equal(rustCarrierSupportsObjectIdentity(map), true);
  assert.equal(rustCarrierSupportsObjectIdentity(symbol), false);
  assert.equal(rustCarrierSupportsObjectIdentity(float64), false);
  assert.equal(rustCarrierSupportsObjectIdentity(userType), false);
});

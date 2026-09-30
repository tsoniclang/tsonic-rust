import assert from "node:assert/strict";
import test from "node:test";
import { selectRustBindingNormalization } from "../../../dist/policy/types/binding-normalization.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustOptionTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("binding absence normalization retains genuine native options and exact checked inputs", () => {
  const integer = rustSourcePrimitiveTargetType("int64");
  for (const element of [integer, rustSourceOptionalTargetType(integer), rustJsValueTargetType(), rustOptionTargetType(integer)]) {
    const projected = rustOptionTargetType(element);
    const selected = selectRustBindingNormalization(projected, undefined, element);
    assert.deepEqual(selected.storageCarrier, rustSourceOptionalTargetType(element));
    assert.deepEqual(selected.bindingCarrier, selected.storageCarrier);
    assert.equal(selected.normalization, "checked-array");
    const defaulted = selectRustBindingNormalization(projected, integer, element);
    assert.equal(defaulted.normalization, "checked-array-default");
    if (element === integer || element.sourceAbsence === true) assert.deepEqual(defaulted.bindingCarrier, integer);
  }
  assert.equal(selectRustBindingNormalization(integer, undefined, integer), undefined);
  assert.equal(selectRustBindingNormalization(rustOptionTargetType(integer), undefined, rustSourcePrimitiveTargetType("uint64")), undefined);
  assert.deepEqual(selectRustBindingNormalization(integer, integer), { storageCarrier: integer, bindingCarrier: integer, normalization: "identity" });
  const nullable = rustSourceOptionalTargetType(integer);
  assert.deepEqual(selectRustBindingNormalization(rustOptionTargetType(nullable), nullable, nullable).bindingCarrier, nullable);
});

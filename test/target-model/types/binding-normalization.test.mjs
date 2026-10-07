import assert from "node:assert/strict";
import test from "node:test";
import { rustBindingNormalizationContract } from "../../../dist/target-model/types/binding-normalization.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustAbsenceTargetType, rustOptionTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("binding absence normalization retains genuine native options and exact checked inputs", () => {
  const integer = rustSourcePrimitiveTargetType("int64");
  for (const element of [integer, rustSourceOptionalTargetType(integer), rustJsValueTargetType(), rustOptionTargetType(integer)]) {
    const projected = rustOptionTargetType(element);
    const selected = rustBindingNormalizationContract(projected, undefined, element);
    assert.deepEqual(selected.storageCarrier, rustSourceOptionalTargetType(element));
    assert.deepEqual(selected.bindingCarrier, selected.storageCarrier);
    assert.equal(selected.normalization, "checked-array");
    const defaulted = rustBindingNormalizationContract(projected, integer, element);
    assert.equal(defaulted.normalization, "checked-array-default");
    if (element === integer || element.sourceAbsence === true) assert.deepEqual(defaulted.bindingCarrier, integer);
  }
  assert.equal(rustBindingNormalizationContract(integer, undefined, integer), undefined);
  assert.equal(rustBindingNormalizationContract(rustOptionTargetType(integer), undefined, rustSourcePrimitiveTargetType("uint64")), undefined);
  assert.deepEqual(rustBindingNormalizationContract(integer, integer), { storageCarrier: integer, bindingCarrier: integer, normalization: "identity" });
  const nullable = rustSourceOptionalTargetType(integer);
  assert.deepEqual(rustBindingNormalizationContract(rustOptionTargetType(nullable), nullable, nullable).bindingCarrier, nullable);
});

test("an exact absence default selects its checked value without manufacturing optional storage", () => {
  const absence = rustAbsenceTargetType();
  const integer = rustSourcePrimitiveTargetType("int64");
  assert.deepEqual(rustBindingNormalizationContract(absence, integer), {
    storageCarrier: absence, bindingCarrier: integer, normalization: "default-on-absence",
  });
  assert.deepEqual(rustBindingNormalizationContract(absence, absence), {
    storageCarrier: absence, bindingCarrier: absence, normalization: "default-on-absence",
  });
  assert.deepEqual(rustBindingNormalizationContract(absence, undefined), {
    storageCarrier: absence, bindingCarrier: absence, normalization: "identity",
  });
  assert.equal(rustBindingNormalizationContract(absence, integer, integer), undefined);
  assert.deepEqual(rustBindingNormalizationContract(integer, integer), {
    storageCarrier: integer, bindingCarrier: integer, normalization: "identity",
  });
});

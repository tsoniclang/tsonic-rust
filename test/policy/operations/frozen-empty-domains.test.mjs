import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/selection.js";
import { rustSourceStorageProjectedCarrier } from "../../../dist/analysis/objects/value-domain-carriers.js";
import {
  rustEmptyObjectTargetType, rustFixedArrayTargetType, rustJsArrayTargetType,
  rustJsValueTargetType, rustTsValueTargetType,
} from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const carrier of [rustEmptyObjectTargetType(), rustTsValueTargetType(), rustJsValueTargetType()]) {
  test(`${carrier.id} freeze is the exact native identity without origin evidence`, () => {
    const selected = selectJsSurfaceOperation({
      ownerName: "ObjectConstructor", memberName: "freeze", operationKind: "call",
      argumentCarriers: [carrier],
    });
    assert.equal(selected?.fact.target.path, "core::convert::identity", "the one native identity path");
    assert.equal(selected.fact.target.argModes[0], "value", "ordinary value passing");
    assert.equal(rustTargetTypeRefEquals(selected.parameterCarriers[0], carrier), true, "the exact input");
    assert.equal(rustTargetTypeRefEquals(selected.resultCarrier, carrier), true, "the exact result");
    assert.equal(selected.fact.isFallible, false, "no runtime state check");
    assert.equal(selectJsSurfaceOperation({
      ownerName: "ObjectConstructor", memberName: "isFrozen", operationKind: "call",
      argumentCarriers: [carrier],
    }), undefined, "no runtime isFrozen operation is admitted");
  });
}

test("identity selection preserves arity and refuses an unknown native input carrier", () => {
  for (const argumentCarriers of [[], [undefined], [rustEmptyObjectTargetType(), rustEmptyObjectTargetType()]]) {
    assert.equal(selectJsSurfaceOperation({
      ownerName: "ObjectConstructor", memberName: "freeze", operationKind: "call", argumentCarriers,
    }), undefined, "one checked native operand is required");
  }
});

test("ordinary storage projections retain exact array and tuple element carriers", () => {
  const expected = rustEmptyObjectTargetType();
  const host = { sourceStorage: { failureReason: () => undefined } };
  for (const [carrier, projection, matches] of [
    [{ kind: "array", element: expected }, [{ kind: "array-element" }], true],
    [{ kind: "slice", element: expected }, [{ kind: "array-element" }], true],
    [rustJsArrayTargetType(expected), [{ kind: "array-element" }], true],
    [rustFixedArrayTargetType(expected, 2), [{ kind: "array-element" }], true],
    [{ kind: "tuple", elements: [rustJsValueTargetType(), expected] }, [{ kind: "tuple-element", index: 1 }], true],
    [{ kind: "tuple", elements: [expected] }, [{ kind: "tuple-element", index: 1 }], false],
    [{ kind: "array", element: rustJsValueTargetType() }, [{ kind: "array-element" }], false],
  ]) {
    const selected = rustSourceStorageProjectedCarrier(host, {
      subject: { kind: "value", node: {}, projection }, bindings: {},
    }, carrier);
    assert.equal(rustTargetTypeRefEquals(selected, expected), matches, "no widening or invented element");
  }
});

test("ordinary storage projections still fail closed for missing or failed storage evidence", () => {
  const carrier = rustEmptyObjectTargetType();
  const source = { subject: { kind: "value", node: {}, projection: [] }, bindings: {} };
  assert.equal(rustSourceStorageProjectedCarrier({}, source, carrier), undefined, "no missing-storage fallback");
  assert.equal(rustSourceStorageProjectedCarrier({
    sourceStorage: { failureReason: () => "unavailable source storage" },
  }, source, carrier), undefined, "no unproved storage result");
  assert.equal(rustSourceStorageProjectedCarrier({
    sourceStorage: { failureReason: () => undefined },
  }, { ...source, bindings: undefined }, carrier), undefined, "explicit binding evidence remains required");
});

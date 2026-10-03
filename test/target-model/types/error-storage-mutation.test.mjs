import assert from "node:assert/strict";
import test from "node:test";
import { rustCarrierReferentMutationRequiresMutableBinding, rustOptionTargetType, rustSourceTypeCarrier, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustMutableJsErrorTargetType, rustSourceErrorTargetType, rustWritableSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";

test("sealed Error identity storage uses immutable native receivers", () => {
  for (const carrier of [rustMutableJsErrorTargetType(), rustSourceErrorTargetType(), rustWritableSourceErrorTargetType()]) {
    assert.equal(rustCarrierReferentMutationRequiresMutableBinding(carrier), false);
    assert.equal(rustCarrierReferentMutationRequiresMutableBinding(rustOptionTargetType(carrier)), false);
  }
});

test("native value storage and mutable references retain native referent requirements", () => {
  for (const carrier of [rustStringTargetType(), rustSourceTypeCarrier("source.ts", "Error", "object"),
    { kind: "reference", mutable: true, referent: rustStringTargetType() }]) {
    assert.equal(rustCarrierReferentMutationRequiresMutableBinding(carrier), true);
    assert.equal(rustCarrierReferentMutationRequiresMutableBinding(rustOptionTargetType(carrier)), true);
  }
});

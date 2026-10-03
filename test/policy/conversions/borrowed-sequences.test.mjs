import assert from "node:assert/strict";
import test from "node:test";
import { rustRestSequenceElements } from "../../../dist/target-model/operations/rest-assembly.js";
import { rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustRestSequenceConversion } from "../../../dist/policy/conversions/rest-sequence.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";

test("borrowed readonly native slices reuse the canonical rest sequence element conversion contract", () => {
  const element = rustStringTargetType();
  const source = { kind: "reference", mutable: false, referent: { kind: "slice", element } };
  assert.deepEqual(rustRestSequenceElements(source), { collection: "slice", elements: [element] });
  const selected = selectRustRestSequenceConversion(source, element);
  assert.ok(selected);
  const contract = rustValueConversionContract(selected);
  assert.equal(contract.lowering, "rest-sequence");
  assert.equal(contract.collection, "slice");
  assert.equal(contract.sourceMode, "ref");
  assert.deepEqual(contract.elementConversions, [null]);
  assert.equal(selectRustRestSequenceConversion(source, rustSourcePrimitiveTargetType("int32")), undefined);
  assert.equal(rustRestSequenceElements({ ...source, mutable: true }), undefined);
  assert.equal(rustValueConversionContract({ ...selected, elementConversions: [] }), undefined);
  assert.equal(rustValueConversionContract({ ...selected, source: { ...source, mutable: true } }), undefined);
});

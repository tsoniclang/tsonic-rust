import test from "node:test";
import assert from "node:assert/strict";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/index.js";
import { jsOperationRows } from "../../../dist/policy/operations/source-profiles/js/rows.js";
import { rustJsArrayValueTargetType, rustJsArrayTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("erased array reads retain projection without inferring a native generic element", () => {
  const receiverCarrier = rustJsArrayValueTargetType();
  const indexCarrier = rustSourcePrimitiveTargetType("int32");
  for (const ownerName of ["Array", "ReadonlyArray"]) {
    const length = selectJsSurfaceOperation({ ownerName, memberName: "length", operationKind: "property", receiverCarrier });
    assert.equal(length.fact.target.name, "len");
    const index = selectJsSurfaceOperation({ ownerName, memberName: "index", operationKind: "indexer", receiverCarrier, argumentCarriers: [indexCarrier] });
    assert.equal(index.fact.target.name, "get_number");
    assert.deepEqual(index.fact.sourceResultCarrier, rustJsValueTargetType());
    assert.equal(index.fact.indexedLocationMethod, undefined);
    assert.equal(index.fact.borrowedIndexOperation, undefined);
    assert.notEqual(index.fact.evaluation, "pure");
    const typed = selectJsSurfaceOperation({ ownerName, memberName: "index", operationKind: "indexer",
      receiverCarrier: rustJsArrayTargetType(rustJsValueTargetType()), argumentCarriers: [indexCarrier] });
    assert.equal(typed.fact.target.name, "get_number");
    assert.notEqual(typed.fact.evaluation, "pure");
    assert.deepEqual(typed.fact.borrowedIndexOperation, { method: "borrow_number_element", evaluation: "pure" });
    assert.ok(Object.isFrozen(typed.fact.borrowedIndexOperation));
  }
  const write = selectJsSurfaceOperation({ ownerName: "Array", memberName: "index", operationKind: "index-set", receiverCarrier,
    argumentCarriers: [indexCarrier, rustJsValueTargetType()] });
  assert.equal(write.fact.fallible, true);
  assert.equal(write.fact.target.name, "set_number");
});

test("native array method rows cannot select an erased category as their backing", () => {
  const receiverCarrier = rustJsArrayValueTargetType();
  for (const row of jsOperationRows.filter(candidate => candidate.lane === "js-array" &&
    (candidate.owner === "Array" || candidate.owner === "ReadonlyArray") && candidate.operationKind === "call")) {
    const selected = selectJsSurfaceOperation({ ownerName: row.owner, memberName: row.member, operationKind: row.operationKind,
      receiverCarrier, argumentCarriers: (row.shape.params ?? []).map(() => rustJsValueTargetType()),
      selectedMethodTypeArgumentCarriers: [rustJsValueTargetType()], argumentMatchScore: () => 0 });
    assert.equal(selected, undefined, `${row.owner}.${row.member}.${row.variant ?? ""}`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceMemberRead, selectJsSurfaceMemberWrite } from "../../../dist/policy/operations/source-profiles/js/member-reads.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustJsArrayTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { finalizeProviderOperationFact } from "../../../dist/analysis/operations/provider/calls/template-instantiation.js";
import { rustIndexedLocationContract } from "../../../dist/analysis/facts/indexed-location.js";

const integer = rustSourcePrimitiveTargetType("int32");
const element = rustStringTargetType();
const receiver = rustJsArrayTargetType(element);
const request = { operationKind: "indexer", receiverCarrier: receiver, argumentCarriers: [integer] };
const member = ownerName => ({ profile: "js", ownerName, memberName: "index", declaration: {} });

test("synthesized index contributors retain one native read ABI and checker-selected writability", () => {
  for (const owners of [["Array"], ["ReadonlyArray"], ["ReadonlyArray", "Array"], ["Array", "ReadonlyArray"]]) {
    for (const readonly of [true, false]) {
      const selected = selectJsSurfaceMemberRead(owners.map(member), request, readonly, emptyRustTypeDefinitions);
      assert.ok(selected?.fact.kind === "provider-operation");
      assert.equal(selected.fact.target.name, "get_number");
      assert.deepEqual(selected.fact.borrowedIndexOperation, { method: "borrow_number_element", evaluation: "pure" });
      assert.notEqual(selected.fact.evaluation, "pure");
      assert.deepEqual(selected.fact.sourceResultCarrier, element);
      const location = !readonly && owners.includes("Array");
      assert.equal(selected.fact.indexedLocationMethod, location ? "element_location" : undefined);
      const fact = finalizeProviderOperationFact(selected.fact, [integer], receiver);
      assert.ok(fact);
      assert.ok(Object.isFrozen(fact.borrowedIndexOperation));
      assert.equal(fact.abi.effects.evaluation, "observable");
      assert.equal(rustIndexedLocationContract(fact)?.method, location ? "element_location" : undefined);
      assert.deepEqual(fact.abi.sourceReceiver.carrier, receiver);
    }
  }
});

test("synthesized index selection rejects missing, foreign and conflicting profile evidence", () => {
  for (const members of [[], [member("Array"), undefined], [member("Unknown")],
    [member("Array"), member("String")], [member("Array"), member("TypedArray")],
    [member("Array"), { ...member("Array"), profile: "native" }],
    [member("Array"), { ...member("Array"), memberName: "length" }]]) {
    assert.equal(selectJsSurfaceMemberRead(members, request, false, emptyRustTypeDefinitions), undefined);
  }
  assert.equal(selectJsSurfaceMemberRead([member("Array")],
    { ...request, argumentCarriers: [element] }, false, emptyRustTypeDefinitions), undefined);
});

test("synthesized member writes require checker writability and exact native read/write agreement", () => {
  const write = { ...request, operationKind: "index-set", argumentCarriers: [integer, element] };
  for (const owners of [["Array"], ["Array", "ReadonlyArray"], ["ReadonlyArray", "Array"]]) {
    const members = owners.map(member);
    const selected = selectJsSurfaceMemberWrite(members, write, false, emptyRustTypeDefinitions);
    assert.equal(selected?.fact.kind, "runtime-set");
    assert.equal(selected?.fact.target.name, "set_number");
    assert.deepEqual(selected.parameterCarriers, [integer, element]);
    assert.equal(selectJsSurfaceMemberWrite(members, write, true, emptyRustTypeDefinitions), undefined);
  }
  for (const members of [[], [member("ReadonlyArray")], [member("Array"), member("String")],
    [member("Array"), member("TypedArray")], [member("Array"), undefined]]) {
    assert.equal(selectJsSurfaceMemberWrite(members, write, false, emptyRustTypeDefinitions), undefined);
  }
  for (const owners of [["Array", "ReadonlyArray"], ["ReadonlyArray", "Array"]]) {
    const selected = selectJsSurfaceMemberRead(owners.map(ownerName => ({ ...member(ownerName), memberName: "length" })),
      { operationKind: "property", receiverCarrier: receiver }, true, emptyRustTypeDefinitions);
    assert.equal(selected?.fact.target.name, "len");
    assert.equal(selected?.fact.indexedLocationMethod, undefined);
  }
});

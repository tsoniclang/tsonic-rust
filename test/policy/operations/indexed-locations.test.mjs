import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/js-surface.js";
import { finalizeProviderOperationFact } from "../../../dist/analysis/operations/provider/calls/template-instantiation.js";
import { rustIndexedLocationContract } from "../../../dist/analysis/facts/indexed-location.js";
import { rustJsArrayTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

const element = rustSourcePrimitiveTargetType("int32");
const receiver = rustJsArrayTargetType(element);

function selected(owner, index) {
  return selectJsSurfaceOperation({
    ownerName: owner,
    memberName: "index",
    operationKind: "indexer",
    receiverCarrier: receiver,
    argumentCarriers: [index],
  })?.fact;
}

test("indexed location metadata retains the exact receiver, pointee and index conversion", () => {
  for (const name of ["int32", "float64"]) {
    const index = rustSourcePrimitiveTargetType(name);
    const template = selected("Array", index);
    assert.ok(template);
    const fact = finalizeProviderOperationFact(template, [index], receiver);
    assert.ok(fact);
    const contract = rustIndexedLocationContract(fact);
    assert.equal(contract.method, "element_location");
    assert.deepEqual(contract.pointeeCarrier, element);
    assert.deepEqual(contract.receiverCarrier, receiver);
    assert.equal(contract.index, fact.abi.targetArguments[0]);
    assert.equal(contract.index.conversion.kind, name === "int32" ? "semantic" : "identity");
    if (name === "int32") {
      assert.equal(contract.index.conversion.conversion.id, "exact-i32-to-f64");
    }
    const readonly = finalizeProviderOperationFact(selected("ReadonlyArray", index), [index], receiver);
    assert.ok(readonly);
    assert.equal(rustIndexedLocationContract(readonly), undefined);
  }
});

test("indexed location finalization rejects invalid protocols rather than recovering from getter syntax", () => {
  const index = rustSourcePrimitiveTargetType("float64");
  const template = selected("Array", index);
  for (const mutation of [
    { indexedLocationMethod: "" },
    { indexedLocationMethod: "array.location()" },
    { sourceResultCarrier: undefined },
    { sourceResultCarrier: rustSourcePrimitiveTargetType("bool") },
    { resultCarrier: element },
    { operationKind: "call" },
    { isUnsafe: true },
    { isAsync: true },
  ]) {
    assert.equal(finalizeProviderOperationFact({ ...template, ...mutation }, [index], receiver), undefined, JSON.stringify(mutation));
  }
  const fact = finalizeProviderOperationFact(template, [index], receiver);
  for (const mutate of [
    candidate => { candidate.abi.effects.invocation = "fallible"; },
    candidate => { candidate.abi.targetArguments[0].source.sourceIndex = 1; },
    candidate => { candidate.abi.targetArguments[0].mode = "ref"; },
    candidate => { candidate.abi.sourceArguments = []; },
    candidate => { candidate.abi.targetArguments.push(candidate.abi.targetArguments[0]); },
    candidate => { candidate.abi.targetReceiver.input.mode = "ref-mut"; },
    candidate => { candidate.abi.targetReceiver.input.source = { kind: "argument", sourceIndex: 0 }; },
    candidate => { candidate.abi.sourceReceiver.disposition = "compile-time"; },
  ]) {
    const changed = structuredClone(fact);
    mutate(changed);
    assert.equal(rustIndexedLocationContract(changed), undefined);
  }
});

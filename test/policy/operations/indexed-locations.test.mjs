import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/index.js";
import { finalizeProviderOperationFact } from "../../../dist/analysis/operations/provider/calls/template-instantiation.js";
import { rustIndexedLocationContract } from "../../../dist/analysis/facts/indexed-location.js";
import { rustJsArrayTargetType, rustSourcePrimitiveTargetType, rustSourceOptionalTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";

const element = rustSourcePrimitiveTargetType("int32");
const receiver = rustJsArrayTargetType(element);

function selected(owner, index, sourceReceiver = receiver) {
  return selectJsSurfaceOperation({
    ownerName: owner,
    memberName: "index",
    operationKind: "indexer",
    receiverCarrier: sourceReceiver,
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
    assert.equal(contract.index.conversion.kind, "identity");
    assert.deepEqual(contract.index.conversion.sourceCarrier, index);
    assert.deepEqual(contract.index.conversion.targetCarrier, index);
    const readonly = finalizeProviderOperationFact(selected("ReadonlyArray", index), [index], receiver);
    assert.ok(readonly);
    assert.equal(rustIndexedLocationContract(readonly), undefined);
  }
});

test("indexed location pointees use raw storage rather than collapsed read absence", () => {
  const pointee = rustSourceOptionalTargetType(element);
  const sourceReceiver = rustJsArrayTargetType(pointee);
  const index = rustSourcePrimitiveTargetType("int32");
  const template = selected("Array", index, sourceReceiver);
  const fact = finalizeProviderOperationFact(template, [index], sourceReceiver);
  assert.ok(fact);
  assert.deepEqual(fact.abi.result.rawCarrier, rustOptionTargetType(pointee));
  assert.deepEqual(fact.abi.result.carrier, pointee);
  assert.equal(fact.abi.result.conversion.conversion.kind, "source-optional");
  assert.deepEqual(rustIndexedLocationContract(fact).pointeeCarrier, pointee);
  for (const mutate of [
    candidate => { candidate.sourceResultCarrier = element; },
    candidate => { candidate.abi.result.rawCarrier = pointee; },
    candidate => { candidate.abi.result.conversion.conversion.element = element; },
    candidate => { candidate.abi.result.conversion.sourceCarrier = pointee; },
    candidate => { candidate.abi.result.conversion.targetCarrier = rustOptionTargetType(pointee); },
  ]) {
    const changed = structuredClone(fact);
    mutate(changed);
    assert.equal(rustIndexedLocationContract(changed), undefined);
  }
});

test("indexed results retain explicit native Option nesting instead of manufacturing source absence", () => {
  const pointee = rustOptionTargetType(element);
  const sourceReceiver = rustJsArrayTargetType(pointee);
  const index = rustSourcePrimitiveTargetType("int32");
  const fact = finalizeProviderOperationFact(selected("Array", index, sourceReceiver), [index], sourceReceiver);
  assert.ok(fact);
  assert.deepEqual(fact.abi.result.rawCarrier, rustSourceOptionalTargetType(pointee));
  assert.deepEqual(fact.abi.result.carrier, rustSourceOptionalTargetType(pointee));
  assert.equal(fact.abi.result.conversion.kind, "identity");
  assert.deepEqual(rustIndexedLocationContract(fact).pointeeCarrier, pointee);
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

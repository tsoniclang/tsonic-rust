import assert from "node:assert/strict";
import test from "node:test";
import { rustFinalizedSourceInputs } from "../../../../dist/target-model/operations/finalized-inputs.js";
import { providerTargetRuntimeSlotKeys, sourceRuntimeSlots } from "../../../../dist/backend/planner/project/provider-source-inputs.js";
import { selectRustProviderSourceOccurrence } from "../../../../dist/analysis/operations/provider-source-inputs.js";

function prepared(abi, receiver, argumentsList) {
  const node = Object.freeze({ name: "operation" });
  const operation = Object.freeze({ kind: "provider-operation", abi });
  const occurrence = selectRustProviderSourceOccurrence(node, operation, receiver, argumentsList);
  // The planner reads the sealed provider evaluation records; this fixture publishes the one selected occurrence.
  const plan = Object.freeze({ providerSourceOccurrence: Object.freeze({
    get: (subject, fact) => subject === node && fact === operation ? occurrence : undefined }) });
  return {
    keys: providerTargetRuntimeSlotKeys(plan, node, operation),
    slots: sourceRuntimeSlots(plan, node, operation)?.map(slot => ({ key: slot.key, node: slot.node,
      ...(slot.evaluationOnly === undefined ? {} : { evaluationOnly: slot.evaluationOnly }) })),
    occurrence, node, operation, plan,
  };
}

test("provider runtime slot keys consume the single finalized source-input order without removing repetitions", () => {
  const input = source => ({ source });
  const receiver = input({ kind: "receiver" });
  const first = input({ kind: "argument", sourceIndex: 0 });
  const third = input({ kind: "argument", sourceIndex: 2 });
  const abi = {
    sourceReceiver: { kind: "receiver", disposition: "runtime" },
    sourceArguments: [0, 1, 2].map(sourceIndex => ({ sourceIndex, disposition: "runtime" })),
    targetReceiver: { kind: "input", input: receiver },
    targetArguments: [
      third,
      { source: { kind: "argument-array" }, elements: [first, third] },
      { source: { kind: "argument-slice" }, elements: [third, first] },
      { source: { kind: "argument-tagged-array" }, elements: [{ input: first }, { input: third }] },
      { source: { kind: "constant" } },
      { source: { kind: "dispatch-context" } },
    ],
  };
  assert.deepEqual(rustFinalizedSourceInputs(abi), [receiver, third, first, third, third, first, first, third]);
  assert.deepEqual(prepared(abi, {}, [{}, {}, {}]).keys, [
    "receiver", "argument:2", "argument:0", "argument:2", "argument:2", "argument:0", "argument:0", "argument:2",
  ]);
  assert.deepEqual(prepared({ ...abi, targetReceiver: { kind: "none" }, targetArguments: [] }, {}, [{}, {}, {}]).keys, []);
});

test("source evaluation slots remain separate from native target input consumption", () => {
  const nodes = [{ name: "first" }, { name: "second" }];
  const receiver = { name: "receiver" };
  const abi = {
    sourceReceiver: { kind: "receiver", disposition: "runtime" },
    sourceArguments: [
      { sourceIndex: 0, disposition: "runtime", carrier: { kind: "source-primitive", name: "float64" } },
      { sourceIndex: 1, disposition: "evaluation-only", carrier: { kind: "tuple", elements: [] } },
    ],
    targetReceiver: { kind: "none" },
    targetArguments: [{ source: { kind: "argument", sourceIndex: 0 } }],
  };
  assert.deepEqual(prepared(abi, receiver, nodes).keys, ["argument:0"]);
  assert.deepEqual(prepared(abi, receiver, nodes).slots, [
    { key: "receiver", node: receiver }, { key: "argument:0", node: nodes[0] },
    { key: "argument:1", node: nodes[1], evaluationOnly: "unit" },
  ]);
  assert.equal(prepared(abi, undefined, nodes).slots === undefined, true, "missing required receiver rejects");
  assert.equal(prepared(abi, receiver, [nodes[0]]).slots === undefined, true, "missing evaluated source argument rejects");
});

test("evaluation-only receivers precede arguments while qualifiers have no runtime slot", () => {
  const receiver = { name: "receiver" };
  const argument = { name: "value" };
  const carrier = { kind: "target-named", id: "fixture.NativeValue" };
  const abi = { sourceReceiver: { kind: "receiver", carrier, declaredCarrier: carrier, disposition: "evaluation-only" },
    sourceArguments: [{ sourceIndex: 0, disposition: "runtime", carrier }], targetReceiver: { kind: "none" },
    targetArguments: [{ source: { kind: "argument", sourceIndex: 0 } }] };
  assert.deepEqual(prepared(abi, receiver, [argument]).slots, [
    { key: "receiver", node: receiver, evaluationOnly: "value" },
    { key: "argument:0", node: argument },
  ]);
  assert.deepEqual(prepared(abi, receiver, [argument]).keys, ["argument:0"]);
  assert.equal(prepared(abi, undefined, [argument]).slots === undefined, true,
    "an actual effect-only receiver is still required");
  assert.deepEqual(prepared({ ...abi, sourceReceiver: { kind: "compile-time" } }, receiver, [argument]).slots,
    [{ key: "argument:0", node: argument }]);
  const unit = { kind: "tuple", elements: [] };
  assert.deepEqual(prepared({ ...abi,
    sourceReceiver: { ...abi.sourceReceiver, carrier: unit, declaredCarrier: unit } }, receiver, [argument]).slots[0],
  { key: "receiver", node: receiver, evaluationOnly: "unit" });
});

test("source projection uses exact admitted occurrence and row identities with immutable results", () => {
  const carrier = Object.freeze({ kind: "tuple", elements: Object.freeze([]) });
  const row = Object.freeze({ sourceIndex: 0, carrier, disposition: "evaluation-only" });
  const abi = Object.freeze({ sourceReceiver: Object.freeze({ kind: "none" }), sourceArguments: Object.freeze([row]),
    targetReceiver: Object.freeze({ kind: "none" }), targetArguments: Object.freeze([]) });
  const argument = Object.freeze({ name: "source-only" });
  const current = prepared(abi, undefined, [argument]);
  assert.equal(current.occurrence.slots[0].source.row === row, true, "the actual source ABI row is retained");
  assert.equal(current.occurrence.slots[0].node === argument, true, "the actual source-only occurrence is retained");
  assert.equal(Object.isFrozen(current.occurrence) && Object.isFrozen(current.occurrence.slots) && Object.isFrozen(current.occurrence.slots[0]), true);
  assert.equal(sourceRuntimeSlots(current.plan, current.node, current.operation) === current.occurrence.slots, true, "pure projection preserves identity");
  assert.equal(sourceRuntimeSlots(current.plan, {}, current.operation) === undefined, true, "foreign occurrence is not reconstructed");
  assert.equal(sourceRuntimeSlots(current.plan, current.node, { ...current.operation }) === undefined, true, "copied operation is not admitted");
  assert.throws(() => sourceRuntimeSlots({ abi }, undefined, []), TypeError, "the removed backend classifier signature is not accepted");
});

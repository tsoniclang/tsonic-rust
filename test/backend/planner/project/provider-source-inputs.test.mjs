import assert from "node:assert/strict";
import test from "node:test";
import { rustFinalizedSourceInputs } from "../../../../dist/analysis/operations/finalized-operation/conversions.js";
import { providerTargetRuntimeSlotKeys, sourceRuntimeSlots } from "../../../../dist/backend/planner/project/provider-source-inputs.js";

test("provider runtime slot keys consume the single finalized source-input order without removing repetitions", () => {
  const input = source => ({ source });
  const receiver = input({ kind: "receiver" });
  const first = input({ kind: "argument", sourceIndex: 0 });
  const third = input({ kind: "argument", sourceIndex: 2 });
  const abi = {
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
  assert.deepEqual(providerTargetRuntimeSlotKeys({ abi }), [
    "receiver", "argument:2", "argument:0", "argument:2", "argument:2", "argument:0", "argument:0", "argument:2",
  ]);
  assert.deepEqual(providerTargetRuntimeSlotKeys({ abi: { ...abi, targetReceiver: { kind: "none" }, targetArguments: [] } }), []);
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
  assert.deepEqual(providerTargetRuntimeSlotKeys({ abi }), ["argument:0"]);
  assert.deepEqual(sourceRuntimeSlots({ abi }, receiver, nodes), [
    { key: "receiver", node: receiver }, { key: "argument:0", node: nodes[0] },
    { key: "argument:1", node: nodes[1], evaluationOnly: "unit" },
  ]);
  assert.equal(sourceRuntimeSlots({ abi }, undefined, nodes) === undefined, true, "missing required receiver rejects");
  assert.equal(sourceRuntimeSlots({ abi }, receiver, [nodes[0]]) === undefined, true, "missing evaluated source argument rejects");
});

test("evaluation-only receivers precede arguments while qualifiers have no runtime slot", () => {
  const receiver = { name: "receiver" };
  const argument = { name: "value" };
  const carrier = { kind: "target-named", id: "fixture.NativeValue" };
  const abi = { sourceReceiver: { kind: "receiver", carrier, declaredCarrier: carrier, disposition: "evaluation-only" },
    sourceArguments: [{ sourceIndex: 0, disposition: "runtime", carrier }], targetReceiver: { kind: "none" },
    targetArguments: [{ source: { kind: "argument", sourceIndex: 0 } }] };
  assert.deepEqual(sourceRuntimeSlots({ abi }, receiver, [argument]), [
    { key: "receiver", node: receiver, evaluationOnly: "value" },
    { key: "argument:0", node: argument },
  ]);
  assert.deepEqual(providerTargetRuntimeSlotKeys({ abi }), ["argument:0"]);
  assert.equal(sourceRuntimeSlots({ abi }, undefined, [argument]) === undefined, true,
    "an actual effect-only receiver is still required");
  assert.deepEqual(sourceRuntimeSlots({ abi: { ...abi, sourceReceiver: { kind: "compile-time" } } }, receiver, [argument]),
    [{ key: "argument:0", node: argument }]);
  const unit = { kind: "tuple", elements: [] };
  assert.deepEqual(sourceRuntimeSlots({ abi: { ...abi,
    sourceReceiver: { ...abi.sourceReceiver, carrier: unit, declaredCarrier: unit } } }, receiver, [argument])[0],
  { key: "receiver", node: receiver, evaluationOnly: "unit" });
});

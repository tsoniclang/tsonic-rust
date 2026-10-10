import assert from "node:assert/strict";
import test from "node:test";
import { rustFinalizedSourceInputs } from "../../../../dist/analysis/facts/finalized-operation-abi.js";
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

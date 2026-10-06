import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/index.js";
import { defineJsOperationRows } from "../../../dist/policy/operations/source-profiles/js/model.js";
import { rustCallableTargetType, rustSourcePrimitiveTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";
import { rustJsTimerDispatchContextId } from "../../../dist/public/provider.js";

const input = { contextId: rustJsTimerDispatchContextId, view: "root", mode: "ref", targetArgumentIndex: 0 };

test("timer operations retain one exact root and a native admission error boundary", () => {
  const callback = rustCallableTargetType([], rustUnitTargetType());
  for (const memberName of ["setTimeout", "setInterval"]) {
    for (const argumentCarriers of [[callback], [callback, rustSourcePrimitiveTargetType("float64")]]) {
      const selected = selectJsSurfaceOperation({ ownerName: "Global", memberName, operationKind: "call", argumentCarriers });
      assert.equal(selected !== undefined, true, `${memberName} source arity ${argumentCarriers.length}`);
      assert.deepEqual(selected.fact.dispatchInputs, [input]);
      assert.equal(selected.fact.isFallible, true);
      assert.equal(selected.fact.errorBoundary, "provider-native");
      assert.equal(selected.resultCarrier.name, "uint64", "native timer identity does not round through floating point");
    }
  }
  for (const memberName of ["clearTimeout", "clearInterval"]) {
    const selected = selectJsSurfaceOperation({ ownerName: "Global", memberName, operationKind: "call",
      argumentCarriers: [rustSourcePrimitiveTargetType("uint64")] });
    assert.equal(selected !== undefined, true, `${memberName} exact native integer`);
    assert.deepEqual(selected.fact.dispatchInputs, [input]);
    assert.equal(selected.fact.isFallible, false);
  }
});

test("operation rows reject malformed context inputs before publishing an ABI fact", () => {
  const row = { owner: "Global", member: "timer", operationKind: "call", lane: "global",
    shape: { op: "operation", operationKind: "method", target: { form: "call", path: "timer::schedule" },
      result: { ref: "unit" }, params: [{ ref: "unit" }] } };
  assert.doesNotThrow(() => defineJsOperationRows([{ ...row, dispatchInputs: [input] }]));
  for (const dispatchInputs of [null, {}, new Array(1), [input, input],
    [{ ...input, targetArgumentIndex: 2 }], [{ ...input, view: "root", mode: "value" }],
    [{ ...input, contextId: "" }], [{ ...input, unknown: true }],
    [{ ...input, get view() { throw new Error("metadata accessors must not execute"); } }]]) {
    assert.throws(() => defineJsOperationRows([{ ...row, dispatchInputs }]), /invalid dispatch context inputs/u);
  }
});

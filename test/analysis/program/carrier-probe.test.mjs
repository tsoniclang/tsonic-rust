import assert from "node:assert/strict";
import test from "node:test";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { resolveRustCallableSignatureCarrier } from "../../../dist/analysis/callables/signature-query.js";

const integer = { kind: "source-primitive", name: "int32" };
const abi = { form: "required", mode: "value", valueCarrier: integer, parameterCarrier: integer };

function parentWalk() {
  const records = createRustProgramRecordBuilder();
  const sourceCallableAbi = { resolveParameterAbi() { throw new Error("parent ABI query executed"); } };
  return {
    context: { records, diagnostics: [], ast: { body: () => undefined } },
    moduleBindings: { isNativeCallableExpression: () => false },
    sourceCallableAbi,
    operationOptions: Object.freeze({ sourceCallableAbi,
      callableSignatureCarrier() { throw new Error("parent signature query executed"); } }),
    resolvingCallableSignatures: new Set(),
    callableSignatureCarrierFor: resolveRustCallableSignatureCarrier,
    inferredReturns: new Map(),
    resolvingReturns: new Set(),
  };
}

test("carrier probes bind signature queries to their own transaction and recursion state", () => {
  const parent = parentWalk();
  const declaration = {};
  parent.resolvingCallableSignatures.add(declaration);
  const probe = createRustCarrierProbe(parent);
  assert.equal(probe.resolvingCallableSignatures.has(declaration), false, "parent recursion state is not probe state");
  assert.equal(probe.operationOptions === parent.operationOptions, false, "callbacks belong to the requesting transaction");
  assert.equal(probe.callableSignatureCarrierFor === parent.callableSignatureCarrierFor, true,
    "one unbound algorithm serves the root and probe without a cyclic module import");
  assert.equal(probe.operationOptions.callableSignatureCarrier(declaration) === undefined, true,
    "an unavailable body is checked in the probe without invoking the parent callback");
  assert.equal(probe.resolvingCallableSignatures.size, 0);
  assert.equal(parent.resolvingCallableSignatures.has(declaration), true);
  probe.resolvingCallableSignatures.add(declaration);
  assert.equal(probe.operationOptions.callableSignatureCarrier(declaration) === undefined, true);
  assert.equal(probe.context.diagnostics === parent.context.diagnostics, false);
  assert.equal(probe.inferredReturns === parent.inferredReturns, true, "retain the one return-inference memo");
  assert.equal(probe.resolvingReturns === parent.resolvingReturns, true, "retain the existing inference cycle guard");
});

test("probe ABI queries read local facts and live parent facts through one scoped resolver", () => {
  const parent = parentWalk();
  const probe = createRustCarrierProbe(parent);
  const local = {};
  const inherited = {};
  probe.context.records.sourceParameterAbis.parameter(local, abi);
  const localFact = probe.context.records.sourceParameterAbi.get(local);
  assert.equal(parent.context.records.sourceParameterAbi.get(local) === undefined, true, "probe writes never reach the parent");
  assert.equal(probe.sourceCallableAbi === probe.operationOptions.sourceCallableAbi, true, "one resolver serves both query paths");
  assert.equal(probe.sourceCallableAbi.resolveParameterAbi(local, {}, {}) === localFact, true);
  parent.context.records.sourceParameterAbis.parameter(inherited, abi);
  const inheritedFact = parent.context.records.sourceParameterAbi.get(inherited);
  assert.equal(probe.sourceCallableAbi.resolveParameterAbi(inherited, {}, {}) === inheritedFact, true,
    "a parent admission after probe creation remains visible");
});

test("nested probes inherit live facts without retaining ancestor query closures", () => {
  const parent = parentWalk();
  const probe = createRustCarrierProbe(parent);
  const nested = createRustCarrierProbe(probe);
  const subject = {};
  const later = {};
  nested.context.records.sourceParameterAbis.parameter(subject, abi);
  assert.equal(nested.operationOptions.sourceCallableAbi.resolveParameterAbi(subject, {}, {}) ===
    nested.context.records.sourceParameterAbi.get(subject), true);
  assert.equal(probe.context.records.sourceParameterAbi.get(subject) === undefined, true);
  assert.equal(parent.context.records.sourceParameterAbi.get(subject) === undefined, true);
  probe.context.records.sourceParameterAbis.parameter(later, abi);
  assert.equal(nested.operationOptions.sourceCallableAbi.resolveParameterAbi(later, {}, {}) ===
    probe.context.records.sourceParameterAbi.get(later), true);
  assert.equal(nested.operationOptions.callableSignatureCarrier({}) === undefined, true);
});

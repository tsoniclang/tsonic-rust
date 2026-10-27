import assert from "node:assert/strict";
import test from "node:test";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { resolveRustCallableSignatureCarrier } from "../../../dist/analysis/callables/calls/signature-query.js";

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
    callableSignatures: new WeakMap(),
    finalizedParameters: new WeakSet(),
    capturedBindingStorage: new Map(),
    promotedStorageDeclarations: new Set(),
    callableSignatureCarrierFor: resolveRustCallableSignatureCarrier,
    inferredReturns: new WeakMap(),
    resolvingReturns: new Set(),
    deferredCallbackCalls: new WeakMap(),
    preparedCallbackCalls: new Map(),
    objectLiteralMethodExpressions: new Set(),
    objectLiteralMethodSpreadExpressions: new Set(),
  };
}

test("carrier probes bind signature queries to their own transaction and recursion state", () => {
  const parent = parentWalk();
  const declaration = {};
  const state = { active: true, completed: new Map(), suspensions: new Map() };
  parent.callableSignatures.set(declaration, state);
  parent.finalizedParameters.add(declaration);
  parent.capturedBindingStorage.set(declaration, { carrier: integer, selection: { storage: "value" } });
  const probe = createRustCarrierProbe(parent);
  assert.equal(probe.callableSignatures.has(declaration), false, "parent recursion state is not probe state");
  assert.equal(probe.finalizedParameters.has(declaration), false, "parameter completion belongs to its actual builder");
  assert.equal(probe.capturedBindingStorage.has(declaration), false, "capture completion belongs to its actual builder");
  assert.equal(probe.promotedStorageDeclarations === parent.promotedStorageDeclarations, true,
    "fully collected addressability is shared immutable source input, not a probe result");
  assert.equal(probe.operationOptions === parent.operationOptions, false, "callbacks belong to the requesting transaction");
  assert.equal(probe.callableSignatureCarrierFor === parent.callableSignatureCarrierFor, true,
    "one unbound algorithm serves the root and probe without a cyclic module import");
  assert.equal(probe.operationOptions.callableSignatureCarrier(declaration) === undefined, true,
    "an unavailable body is checked in the probe without invoking the parent callback");
  assert.equal(probe.callableSignatures.has(declaration), false);
  assert.equal(parent.callableSignatures.get(declaration) === state, true);
  probe.callableSignatures.set(declaration, { active: true, completed: new Map(), suspensions: new Map() });
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
  assert.equal(probe.sourceCallableAbi.resolveParameterAbi(local, {}, {})?.abi === localFact, true,
    "the local resolved result retains the published ABI identity");
  parent.context.records.sourceParameterAbis.parameter(inherited, abi);
  const inheritedFact = parent.context.records.sourceParameterAbi.get(inherited);
  assert.equal(probe.sourceCallableAbi.resolveParameterAbi(inherited, {}, {})?.abi === inheritedFact, true,
    "a parent admission after probe creation remains visible");
});

test("nested probes inherit live facts without retaining ancestor query closures", () => {
  const parent = parentWalk();
  const probe = createRustCarrierProbe(parent);
  const nested = createRustCarrierProbe(probe);
  const subject = {};
  const later = {};
  nested.context.records.sourceParameterAbis.parameter(subject, abi);
  assert.equal(nested.operationOptions.sourceCallableAbi.resolveParameterAbi(subject, {}, {})?.abi ===
    nested.context.records.sourceParameterAbi.get(subject), true);
  assert.equal(probe.context.records.sourceParameterAbi.get(subject) === undefined, true);
  assert.equal(parent.context.records.sourceParameterAbi.get(subject) === undefined, true);
  probe.context.records.sourceParameterAbis.parameter(later, abi);
  assert.equal(nested.operationOptions.sourceCallableAbi.resolveParameterAbi(later, {}, {})?.abi ===
    probe.context.records.sourceParameterAbi.get(later), true);
  assert.equal(nested.operationOptions.callableSignatureCarrier({}) === undefined, true);
});

test("pending callbacks and method obligations belong to one actual probe transaction", () => {
  const parent = parentWalk();
  const original = {};
  const candidate = {};
  const pending = {};
  parent.deferredCallbackCalls.set(original, pending);
  parent.preparedCallbackCalls.set(original, pending);
  parent.objectLiteralMethodExpressions.add(original);
  parent.objectLiteralMethodSpreadExpressions.add(original);
  const probe = createRustCarrierProbe(parent);
  const sibling = createRustCarrierProbe(parent);
  const nested = createRustCarrierProbe(probe);
  for (const container of ["deferredCallbackCalls", "preparedCallbackCalls",
    "objectLiteralMethodExpressions", "objectLiteralMethodSpreadExpressions"]) {
    assert.equal(probe[container] === parent[container], false, container);
    assert.equal(probe[container] === sibling[container], false, container);
    assert.equal(probe[container] === nested[container], false, container);
    assert.equal(probe[container].has(original), false, `${container}: pending work is not inherited evidence`);
    if (container.endsWith("Expressions")) probe[container].add(candidate);
    else probe[container].set(candidate, pending);
    probe[container].delete(original);
    assert.equal(parent[container].has(original), true, `${container}: child cannot consume parent work`);
    assert.equal(parent[container].has(candidate), false, `${container}: child cannot enqueue parent work`);
    assert.equal(sibling[container].has(candidate), false, `${container}: sibling remains independent`);
    assert.equal(nested[container].has(candidate), false, `${container}: nested obligations stay local`);
  }
  probe.objectLiteralMethodExpressions.add(candidate);
  assert.equal(probe.objectLiteralMethodExpressions.size, 1, "one expression has one adapter obligation");
});

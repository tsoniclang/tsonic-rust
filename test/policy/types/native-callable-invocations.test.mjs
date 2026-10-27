import assert from "node:assert/strict";
import test from "node:test";
import { rustNativeCallableInvocationArguments } from "../../../dist/policy/types/callables/native-invocations.js";
import { rustCallableTargetType, rustStringTargetType, rustSourceOptionalTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";
import { selectRustCallScopedLifetimeReconciliation, selectRustValueCarrierReconciliation } from "../../../dist/policy/conversions/value-carrier-reconciliation.js";

const string = rustStringTargetType();
const number = rustSourcePrimitiveTargetType("float64");

test("native callable input reconciliation publishes the original call-scoped lifetime instead of placeholder identity", () => {
  const error = { kind: "target-named", id: "test:ExactInvocationError" };
  const source = rustCallableTargetType([], number, { kind: "placeholder" }, error);
  const projectTypes = { definitionForCarrier: () => undefined };
  for (const callIdentity of ["call:first", "call:second"]) {
    const lifetime = { kind: "call-scoped-elision", callIdentity, parameterIdentity: "input:environment" };
    const target = rustCallableTargetType([], number, lifetime, error);
    const selected = selectRustValueCarrierReconciliation(source, target, projectTypes);
    assert.equal(selected.kind, "call-scoped-lifetime", callIdentity + ": the required lifetime transition is published");
    assert.equal(selected.fact.sourceCarrier === source, true, callIdentity + ": original callable identity is unchanged");
    assert.equal(selected.fact.selectedCarrier === target, true, callIdentity + ": the original invocation owns its exact lifetime");
    assert.equal(selectRustValueCarrierReconciliation(target, target, projectTypes).kind, "identity",
      callIdentity + ": already identical physical contracts need no transition");
    const foreign = rustCallableTargetType([], number,
      { ...lifetime, callIdentity: callIdentity + ":foreign" }, error);
    assert.equal(selectRustCallScopedLifetimeReconciliation(target, foreign) === undefined, true,
      callIdentity + ": distinct original calls cannot share a lifetime proof");
    assert.equal(selectRustCallScopedLifetimeReconciliation(source,
      rustCallableTargetType([], number, lifetime, { kind: "target-named", id: "test:OtherInvocationError" })) === undefined,
      true, callIdentity + ": matching lifetimes never replace the invocation error identity");
  }
});

function inputs(parameterCarrier, valueCarrier = string, resultCarrier = number) {
  const binding = { environment: [], protocol: {
    environmentParameters: [],
    signature: { environmentParameters: [], typeParameters: [] },
    method: { parameters: [parameterCarrier], result: number, binder: { parameters: [] } },
  } };
  const operation = { kind: "source-call", parameters: [{ parameterCarrier, valueCarrier }], resultCarrier };
  return { binding, operation };
}

test("native callable matching consumes the selected physical reference ABI, not the logical owned value", () => {
  for (const mutable of [false, true]) {
    const carrier = { kind: "reference", referent: string, mutable };
    const { binding, operation } = inputs(carrier);
    const selected = rustNativeCallableInvocationArguments(binding, operation, "call:reference");
    assert.equal(selected !== undefined && selected.length === 0, true,
      `${mutable ? "exclusive" : "shared"}: exact native reference is retained without an argument adapter`);
  }
});

test("native callable matching keeps the exact optional physical carrier", () => {
  const optional = rustSourceOptionalTargetType(string);
  const { binding, operation } = inputs(optional, optional);
  const selected = rustNativeCallableInvocationArguments(binding, operation, "call:optional");
  assert.equal(selected !== undefined && selected.length === 0, true,
    "the native invocation protocol keeps its one optional argument, not the runtime callable tuple");
});

test("logical coincidence cannot admit a conflicting physical input or result", () => {
  const shared = { kind: "reference", referent: string, mutable: false };
  const { binding, operation } = inputs(shared, shared);
  for (const physical of [string, { ...shared, mutable: true }, rustSourceOptionalTargetType(string)]) {
    assert.equal(rustNativeCallableInvocationArguments(binding, {
      ...operation, parameters: [{ valueCarrier: shared, parameterCarrier: physical }],
    }, "call:conflict") === undefined, true, "only exact physical parameter correspondence admits native invocation");
  }
  assert.equal(rustNativeCallableInvocationArguments(binding, { ...operation, resultCarrier: string }, "call:conflict") === undefined,
    true, "the native result correspondence remains mandatory");
});

test("native callable input lifetime elision belongs to the exact original invocation and binder", () => {
  const lifetime = { kind: "bound", binderIdentity: "native:input", identity: "value", name: "input" };
  const shared = { kind: "reference", referent: string, mutable: false };
  const { binding, operation } = inputs(shared);
  binding.protocol.method.parameters = [{ ...shared, lifetime }];
  binding.protocol.method.binder.parameters = [{ lifetime, outlives: [] }];
  const first = rustNativeCallableInvocationArguments(binding, operation, "call:first");
  const second = rustNativeCallableInvocationArguments(binding, operation, "call:second");
  assert.equal(first?.length, 1, "an actual implicit reference supplies its one native input lifetime");
  assert.equal(first[0].kind === "lifetime" && first[0].lifetime.kind === "call-scoped-elision", true,
    "the native compiler infers this invocation's borrow, never a static or fabricated named lifetime");
  assert.equal(first[0].lifetime.callIdentity, "call:first", "the original call owns its elision");
  assert.equal(first[0].lifetime.parameterIdentity, rustLifetimeKey(lifetime), "the exact method binder owns its slot");
  assert.equal(second?.[0].lifetime.callIdentity, "call:second", "equal headers do not merge distinct invocation lifetimes");
  const foreign = { ...lifetime, binderIdentity: "native:other" };
  const other = { ...binding, protocol: { ...binding.protocol, method: { ...binding.protocol.method,
    parameters: [{ ...shared, lifetime: foreign }], binder: { parameters: [{ lifetime: foreign, outlives: [] }] } } } };
  const selected = rustNativeCallableInvocationArguments(other, operation, "call:first");
  assert.equal(selected?.[0].lifetime.parameterIdentity, rustLifetimeKey(foreign),
    "equal lifetime names never replace their original binder identity");
  assert.equal(selected[0].lifetime.parameterIdentity === first[0].lifetime.parameterIdentity, false,
    "distinct native binders keep distinct parameter identities");
  assert.equal(rustNativeCallableInvocationArguments(binding, operation) === undefined, true,
    "the retired context-free signature is refused");
  assert.equal(rustNativeCallableInvocationArguments(binding, operation, "") === undefined, true,
    "a missing original invocation identity cannot manufacture a lifetime");
});

test("native input elision retains every explicit borrow, referent, result and shared binder constraint", () => {
  const lifetime = { kind: "bound", binderIdentity: "native:shared", identity: "value", name: "input" };
  const named = { kind: "parameter", identity: "caller:input", name: "input" };
  const different = { kind: "parameter", identity: "caller:other", name: "other" };
  const shared = { kind: "reference", referent: string, mutable: false };
  const { binding, operation } = inputs(shared);
  binding.protocol.method.parameters = [{ ...shared, lifetime }];
  binding.protocol.method.result = { ...shared, lifetime };
  binding.protocol.method.binder.parameters = [{ lifetime, outlives: [] }];
  const exact = { ...operation, parameters: [{ parameterCarrier: { ...shared, lifetime: named }, valueCarrier: string }],
    resultCarrier: { ...shared, lifetime: named } };
  const selected = rustNativeCallableInvocationArguments(binding, exact, "call:named");
  assert.equal(selected?.[0].lifetime === named, true, "an explicit checked caller lifetime is preserved exactly");
  for (const physical of [string, { ...shared, mutable: true }, { ...shared, referent: number }]) {
    assert.equal(rustNativeCallableInvocationArguments(binding, { ...exact,
      parameters: [{ parameterCarrier: physical, valueCarrier: string }] }, "call:named") === undefined,
    true, "elision does not change ownership, mutability or the native referent");
  }
  for (const resultCarrier of [number, { ...shared, mutable: true, lifetime: named },
    { ...shared, lifetime: different }]) {
    assert.equal(rustNativeCallableInvocationArguments(binding, { ...exact, resultCarrier }, "call:named") === undefined,
      true, "the exact returned carrier and shared input/result lifetime remain mandatory");
  }
});

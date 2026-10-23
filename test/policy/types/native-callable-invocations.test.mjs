import assert from "node:assert/strict";
import test from "node:test";
import { rustNativeCallableInvocationArguments } from "../../../dist/policy/types/callables/native-invocations.js";
import { rustStringTargetType, rustSourceOptionalTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

const string = rustStringTargetType();
const number = rustSourcePrimitiveTargetType("float64");

function inputs(parameterCarrier, valueCarrier = string, resultCarrier = number) {
  const binding = { environment: [], protocol: {
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
    const selected = rustNativeCallableInvocationArguments(binding, operation);
    assert.equal(selected !== undefined && selected.length === 0, true,
      `${mutable ? "exclusive" : "shared"}: exact native reference is retained without an argument adapter`);
  }
});

test("native callable matching keeps the exact optional physical carrier", () => {
  const optional = rustSourceOptionalTargetType(string);
  const { binding, operation } = inputs(optional, optional);
  const selected = rustNativeCallableInvocationArguments(binding, operation);
  assert.equal(selected !== undefined && selected.length === 0, true,
    "the native invocation protocol keeps its one optional argument, not the runtime callable tuple");
});

test("logical coincidence cannot admit a conflicting physical input or result", () => {
  const shared = { kind: "reference", referent: string, mutable: false };
  const { binding, operation } = inputs(shared, shared);
  for (const physical of [string, { ...shared, mutable: true }, rustSourceOptionalTargetType(string)]) {
    assert.equal(rustNativeCallableInvocationArguments(binding, {
      ...operation, parameters: [{ valueCarrier: shared, parameterCarrier: physical }],
    }) === undefined, true, "only exact physical parameter correspondence admits native invocation");
  }
  assert.equal(rustNativeCallableInvocationArguments(binding, { ...operation, resultCarrier: string }) === undefined,
    true, "the native result correspondence remains mandatory");
});

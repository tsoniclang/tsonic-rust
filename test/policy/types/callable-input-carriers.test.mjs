import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustCallableInputCarrier } from "../../../dist/policy/types/resolution/callable-inputs.js";
import { rustCallableTargetType, rustCallableInputTargetType, rustCallableInputProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { sourceCallSelectedMemberMatches } from "../../../dist/backend/planner/expressions/calls/arguments.js";

const value = { kind: "target-named", id: "rust.std.String" };
const borrowed = { kind: "reference", mutable: false, referent: value };
const logical = rustCallableTargetType([value], value);
const subject = { kind: "value", node: {}, projection: [] };

function select(carriers, resolved = true) {
  const declarations = carriers.map(() => ({}));
  return resolveRustCallableInputCarrier(subject, logical, {
    sourceStorage: { originsFor: selected => {
      assert.equal(selected === subject, true);
      return resolved ? { kind: "resolved", origins: declarations.map(node =>
        ({ subject: { kind: "value", node, projection: [] } })) } : { kind: "unresolved", reason: "missing exact flow" };
    } },
  }, { callableSignatureCarrier: declaration => carriers[declarations.indexOf(declaration)] });
}

test("invocation-only inputs preserve one exact native numeric result until an explicit return contract", () => {
  const native = { kind: "source-primitive", name: "uint32" };
  const float = { kind: "source-primitive", name: "float64" };
  const origin = {};
  const declared = rustCallableTargetType([value], float);
  const selected = resolveRustCallableInputCarrier(subject, declared, {
    sourceStorage: { originsFor: () => ({ kind: "resolved", origins: [
      { subject: { kind: "value", node: origin, projection: [] } },
    ] }) },
  }, { callableSignatureCarrier: () => rustCallableTargetType([borrowed], native) });
  assert.equal(rustCallableInputProtocol(selected)?.result === native, true,
    "the producer's native result is not rounded or adapted inside the borrowed callback");
  for (const results of [[native, float], [float, native]]) {
    let index = 0;
    const rejected = resolveRustCallableInputCarrier(subject, declared, {
      sourceStorage: { originsFor: () => ({ kind: "resolved", origins: results.map(() =>
        ({ subject: { kind: "value", node: {}, projection: [] } })) }) },
    }, { callableSignatureCarrier: () => rustCallableTargetType([borrowed], results[index++]) });
    assert.equal(rejected === undefined, true, "different native result ABIs cannot be combined");
  }
});

test("closed invocation inputs retain the producer's exact borrowed protocol without a value adapter", () => {
  const selected = select([rustCallableTargetType([borrowed], value), rustCallableTargetType([borrowed], value)]);
  assert.equal(rustCallableInputProtocol(selected)?.parameters[0] === borrowed, true);
  assert.equal(rustCallableInputProtocol(selected)?.result === value, true);
  assert.equal(rustCallableInputProtocol(select([logical]))?.parameters[0] === value, true);
  assert.equal(rustCallableInputProtocol(select([undefined]))?.parameters[0] === value, true,
    "an open signature retains the declared native invocation contract, not a guessed borrow");
});

test("closed invocation inputs reject conflicting physical protocols and missing transport evidence", () => {
  const mutable = { ...borrowed, mutable: true };
  const integer = { kind: "source-primitive", name: "int32" };
  for (const carriers of [
    [rustCallableTargetType([borrowed], value), logical],
    [rustCallableTargetType([mutable], value)],
    [rustCallableTargetType([], value)],
    [rustCallableTargetType([borrowed], integer)],
    [undefined, rustCallableTargetType([borrowed], value)],
    [rustCallableTargetType([borrowed], value), undefined],
  ]) assert.equal(select(carriers) === undefined, true, "no ABI widening or borrowed-value erasure");
  assert.equal(select([logical], false) === undefined, true, "unresolved exact transport cannot prove an input ABI");
});

test("finalized invocation input facts retain exact borrowed argument modes without relaxing native reference contracts", () => {
  const carrier = rustCallableInputTargetType([borrowed], value);
  const member = { id: "callback", kind: "method", targetName: "invoke", returnType: value,
    parameters: [{ name: "value", type: borrowed }] };
  const selected = { member, sourceCallableCarrier: carrier };
  const parameter = { form: "required", parameterCarrier: borrowed, valueCarrier: value, mode: "ref", inputs: [] };
  const fact = { kind: "source-call", operationId: "callback", resultCarrier: value,
    target: { form: "callable", carrier }, parameters: [parameter] };
  const matches = candidate => sourceCallSelectedMemberMatches(candidate, selected, value, type => type, undefined);
  assert.equal(matches(fact), true);
  for (const change of [
    { mode: "mut-ref" },
    { valueCarrier: { kind: "source-primitive", name: "int32" } },
    { parameterCarrier: value },
  ]) assert.equal(matches({ ...fact, parameters: [{ ...parameter, ...change }] }), false,
    "immutable borrowing requires the identical referent, parameter carrier and passing mode");
  assert.equal(matches({ ...fact, target: { form: "callable",
    carrier: { kind: "function-pointer", args: [borrowed], result: value } } }), false,
    "a native reference value parameter is not an inferred invocation-only borrow");
});

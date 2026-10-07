import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableInputMatches } from "../../../dist/target-model/conversions/callable-input.js";
import { selectRustCallableConversion, rustCallableConversionMatches } from "../../../dist/target-model/conversions/callable.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustCallableTargetType, rustCallableInputTargetType, rustCallableInputProtocol, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustFrameCallableTargetType } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rebindRustCallableCarrier } from "../../../dist/target-model/types/carriers/callable-rebinding.js";

const integer = { kind: "source-primitive", name: "int64" };
const number = { kind: "source-primitive", name: "float64" };
const owner = { kind: "lexical", origin: { fileName: "/project/index.ts", declarationIdentity: "activation" } };

test("invocation inputs borrow an exact physical callable without constructing an owned adapter", () => {
  const target = rustCallableInputTargetType([integer], integer);
  for (const source of [rustCallableTargetType([integer], integer),
    rustFrameCallableTargetType([integer], integer, owner)]) {
    const conversion = selectRustSourceValueConversion(source, target);
    assert.equal(conversion?.kind, "callable-input");
    assert.equal(rustCallableInputMatches(source, target), true);
    const contract = rustValueConversionContract(conversion);
    assert.equal(contract?.lowering, "identity");
    assert.equal(contract?.sourceMode, "ref");
    assert.equal(contract?.fallible, false);
    assert.equal(selectRustCallableConversion(source, target, selectRustSourceValueConversion) === undefined, true,
      "borrowed inputs never select an allocating callable adapter");
    assert.equal(rustCallableConversionMatches({ kind: "callable-adapter", source, target,
      parameters: [{ kind: "identity" }], result: { kind: "identity" } }, source, target), false);
    for (const changed of [
      { ...conversion, source: rustCallableTargetType([number], integer) },
      { ...conversion, source: rustCallableTargetType([integer], number) },
      { ...conversion, target: rustCallableTargetType([integer], integer) },
      { ...conversion, target: rustCallableInputTargetType([], integer) },
      { ...conversion, source: target.referent },
      { ...conversion, unchecked: true },
    ]) assert.equal(rustValueConversionContract(changed) === undefined, true, "invalid input proof rejects");
  }
  assert.equal(selectRustSourceValueConversion(integer, target) === undefined, true);
});

test("signature rebinding and generic substitution preserve the invocation-only protocol", () => {
  const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
  const source = rustCallableTargetType([parameter], parameter);
  const target = rustCallableInputTargetType([parameter], parameter);
  const converted = substituteRustValueConversion({ kind: "callable-input", source, target }, new Map([["Value", integer]]));
  assert.equal(rustValueConversionContract(converted) !== undefined, true);
  const rebound = rebindRustCallableCarrier(target, [number], integer);
  assert.equal(rustCallableInputProtocol(rebound) !== undefined, true);
  assert.equal(rustCallableInputProtocol(rebound).parameters[0].name, "float64");
  assert.equal(rustCallableInputProtocol(rebound).result.name, "int64");
});

test("invocation-only callable adaptation reuses exact shared borrowing without retaining its source", () => {
  const value = rustStringTargetType();
  const borrowed = { kind: "reference", referent: value, mutable: false };
  const target = rustCallableInputTargetType([value], integer);
  for (const source of [rustCallableTargetType([borrowed], integer), rustCallableInputTargetType([borrowed], integer)]) {
    const selected = selectRustCallableConversion(source, target, selectRustSourceValueConversion);
    assert.equal(selected !== undefined, true);
    assert.equal(selected.parameters[0].kind, "borrow");
    assert.equal(rustCallableConversionMatches(selected, source, target), true);
    assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.parameters[0]), true);
    for (const changed of [
      { ...selected, extra: true }, { ...selected, parameters: [{ kind: "identity" }] },
      { ...selected, parameters: [{ kind: "borrow", unchecked: true }] },
      { ...selected, result: { kind: "borrow" } }, { ...selected, source: target },
      { ...selected, parameters: [] },
    ]) assert.equal(rustCallableConversionMatches(changed, source, target), false);
  }
  const source = rustCallableInputTargetType([borrowed], integer);
  const escaping = rustCallableTargetType([value], integer);
  assert.equal(selectRustCallableConversion(source, escaping, selectRustSourceValueConversion) === undefined, true);
});

test("invocation-only adapters reject mutable, escaping-lifetime and incompatible parameter evidence", () => {
  const value = rustStringTargetType();
  const target = rustCallableInputTargetType([value], integer);
  for (const parameter of [
    { kind: "reference", referent: value, mutable: true },
    { kind: "reference", referent: value, mutable: false, lifetime: { kind: "static" } },
    { kind: "reference", referent: value, mutable: false, lifetime: { kind: "placeholder" } },
    { kind: "reference", referent: integer, mutable: false },
  ]) assert.equal(selectRustCallableConversion(rustCallableTargetType([parameter], integer), target,
    selectRustSourceValueConversion) === undefined, true);
  assert.equal(selectRustCallableConversion(rustCallableTargetType([value, value], integer), target,
    selectRustSourceValueConversion) === undefined, true);
  assert.equal(selectRustCallableConversion(rustCallableTargetType([value], value), target,
    selectRustSourceValueConversion) === undefined, true);
});

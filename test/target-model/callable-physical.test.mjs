import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableConversionPhysical, rustCallableConversionErrorArities, rustCallablePhysicalSignature }
  from "../../dist/target-model/conversions/callable-physical.js";
import { selectRustCallableConversion } from "../../dist/target-model/conversions/callable.js";
import { selectRustExactIntegerConversion } from "../../dist/target-model/conversions/exact-integer.js";
import { rustCallableTargetType, rustCallableInputTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetId, rustInfallibleTargetId } from "../../dist/target-model/types/carriers/source-types.js";
import { rustFutureTargetType } from "../../dist/target-model/types/carriers/primitives.js";
import { rustNativeErrorJoinReference } from "../../dist/target-model/types/native-error-joins.js";
import { rustRuntimeErrorTargetType } from "../../dist/target-model/operations/error-boundary.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { rustNativeCompletionFutureType } from "../../dist/target-model/types/callable-completions.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const infallible = { kind: "target-named", id: rustInfallibleTargetId };
const failure = rustNamedTargetType("fixture:Failure", "Failure", [], [], undefined, [], undefined, []);
const file = "/adapt.ts";
const select = (source, target) => selectRustCallableConversion(source, target, selectRustExactIntegerConversion);
const physicalCarrier = ({ parameters, result, error }) => rustNamedTargetType(rustCallableTargetId, "rt::Callable", [
  { kind: "lifetime", lifetime: { kind: "static" } },
  { kind: "type", type: { kind: "tuple", elements: parameters } },
  { kind: "type", type: rustNamedTargetType("rust.core.Result", "Result", [
    { kind: "type", type: result }, { kind: "type", type: error },
  ], [], undefined, [], undefined, []) },
], [], undefined, [], undefined, []);

test("physical adapters preserve source error and native Future payload without ambient substitution", () => {
  const future = rustFutureTargetType(integer);
  const selected = select(rustCallableTargetType([], future), rustCallableTargetType([integer], future));
  const native = rustNativeCompletionFutureType({ identity: "fixture:Future", output: integer, error: failure, captures: [] });
  for (const error of [infallible, failure]) {
    const physical = rustCallableConversionPhysical(selected, { parameters: [], result: native, error }, file);
    assert.equal(physical !== undefined, true);
    assert.equal(rustTargetTypeRefEquals(physical.result, native), true);
    assert.equal(rustTargetTypeRefEquals(physical.error, error), true);
    assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).result, native), true);
    assert.equal(physical.errors.length, 1);
    assert.equal(Object.isFrozen(physical.arguments), true);
    assert.equal(Object.isFrozen(physical.source), true);
    assert.equal(Object.isFrozen(physical.result.bounds), true);
  }
  assert.deepEqual(rustCallableConversionErrorArities(selected), []);
});

test("fallible argument and result adapters expose canonical distinct exact error channels", () => {
  const selected = select(rustCallableTargetType([integer], wide), rustCallableTargetType([wide], integer));
  const physical = rustCallableConversionPhysical(selected, { parameters: [integer], result: wide, error: failure }, file);
  assert.equal(physical !== undefined, true);
  assert.deepEqual(physical.errors.map(error => error.identity), ["invoke", "parameter:0", "result"]);
  assert.deepEqual(rustCallableConversionErrorArities(selected), [3]);
  const joined = rustNativeErrorJoinReference(physical.error);
  assert.equal(joined.errors.length, 3);
  assert.equal(rustTargetTypeRefEquals(joined.errors[0], failure), true);
  assert.equal(joined.errors.slice(1).every(error => rustTargetTypeRefEquals(error, rustRuntimeErrorTargetType())), true);
  assert.equal(physical.arguments[0].errorIdentity, "parameter:0");
  assert.equal(physical.resultPlan.errorIdentity, "result");
  assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).error, physical.error), true);
});

test("nested result adaptation reuses its own exact physical payload not the outer callable", () => {
  const original = rustCallableTargetType([], wide);
  const target = rustCallableTargetType([], integer);
  const selected = select(rustCallableTargetType([], original), rustCallableTargetType([], target));
  const nested = { parameters: [], result: wide, error: failure };
  const physical = rustCallableConversionPhysical(selected,
    { parameters: [], result: physicalCarrier(nested), error: infallible }, file);
  assert.equal(physical !== undefined, true);
  assert.equal(physical.resultPlan.kind, "callable");
  assert.equal(rustTargetTypeRefEquals(physical.error, infallible), true, "constructing the nested adapter is infallible");
  assert.equal(rustTargetTypeRefEquals(physical.resultPlan.conversion.source.error, failure), true);
  assert.equal(rustNativeErrorJoinReference(rustCallablePhysicalSignature(physical.result).error).errors.length, 2);
  assert.deepEqual(rustCallableConversionErrorArities(selected), [2]);
});

test("borrowed input adapters expose native tuple closure and exact Result without owning storage", () => {
  const selected = select(rustCallableTargetType([], integer), rustCallableInputTargetType([integer], integer));
  const physical = rustCallableConversionPhysical(selected, { parameters: [], result: integer, error: failure }, file);
  assert.equal(physical !== undefined, true);
  assert.equal(physical.carrier.kind, "closure");
  assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).error, failure), true);
});

test("physical adapter validation rejects malformed selections and inconsistent exact inputs", () => {
  const selected = select(rustCallableTargetType([integer], wide), rustCallableTargetType([wide], integer));
  const actual = { parameters: [integer], result: wide, error: failure };
  for (const [label, source] of [["arity", { ...actual, parameters: [] }], ["sparse", { ...actual, parameters: new Array(1) }],
    ["input", { ...actual, parameters: [wide] }], ["result", { ...actual, result: integer }],
    ["missing error", { ...actual, error: undefined }], ["extra", { ...actual, extra: true }]])
    assert.equal(rustCallableConversionPhysical(selected, source, file) === undefined, true, label);
  for (const changed of [null, undefined, { ...selected, extra: true }, { ...selected, result: { kind: "borrow" } },
    { ...selected, parameters: [] }]) {
    assert.equal(rustCallableConversionPhysical(changed, actual, file) === undefined, true);
    assert.equal(rustCallableConversionErrorArities(changed) === undefined, true);
  }
  assert.equal(rustCallablePhysicalSignature(selected.source) === undefined, true, "logical source cannot masquerade as physical");
  const invalid = { ...physicalCarrier(actual), value: { ...physicalCarrier(actual).value, id: "fixture:Other" } };
  assert.equal(rustCallablePhysicalSignature(invalid) === undefined, true);
});

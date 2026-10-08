import assert from "node:assert/strict";
import test from "node:test";
import { selectRustCallableStorageLifetime, selectRustSuspendedStorageLifetime } from "../../../dist/policy/ownership/suspended-storage.js";
import { bindRustElidedCallableInput, instantiateRustElidedCallResult, rustSingleElidedInput, substituteElidedLifetime } from "../../../dist/target-model/types/carriers/lifetime-elision.js";
import { requirementUseHasValidStorage } from "../../../dist/analysis/declarations/generic-requirement-contract.js";
import { rustNativeRepresentationMatches } from "../../../dist/target-model/conversions/native-representation.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustJsPromiseTargetTypeWithLifetime, rustUnitTargetType, rustAbsenceTargetType,
  rustSourcePrimitiveTargetType, rustJsErrorTargetType } from "../../../dist/target-model/types/index.js";
import { sourceCallSelectedMemberMatches } from "../../../dist/backend/planner/expressions/calls/arguments.js";
import { rustSourceCallResultWithInputLifetimes } from "../../../dist/analysis/facts/source-call-lifetimes.js";
import { rustCallableInputTargetType, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";

const inferred = { kind: "placeholder" };
const owned = { kind: "static" };
const borrowed = { kind: "parameter", identity: "scope::borrow", name: "borrow" };
const promise = (lifetime, payload = rustUnitTargetType()) => rustJsPromiseTargetTypeWithLifetime(payload, lifetime);

test("suspended input elision follows native signature scopes, never field or ambiguous inference", () => {
  const input = promise(inferred);
  assert.deepEqual(selectRustCallableStorageLifetime([input], [input]), inferred);
  assert.equal(selectRustSuspendedStorageLifetime([input]), undefined);
  assert.equal(selectRustCallableStorageLifetime([input, input], [input]), undefined);
  assert.equal(selectRustCallableStorageLifetime([input, promise(owned)], [input]), undefined);
  assert.equal(selectRustCallableStorageLifetime([input, promise(borrowed)], [input]), undefined);
  assert.equal(selectRustCallableStorageLifetime([input], [input, promise(borrowed)]), undefined);
  const callback = { kind: "function-pointer", args: [{ kind: "reference", referent: rustUnitTargetType(), mutable: false }],
    result: rustUnitTargetType() };
  assert.deepEqual(rustTargetGenericReferences(callback).elisionInputs, []);
  assert.equal(rustTargetGenericReferences(callback).hasUnnameableLifetime, false);
  assert.equal(rustSingleElidedInput([callback, input]), 1);
  const explicitlyBorrowed = { ...callback, args: [{ ...callback.args[0], lifetime: borrowed }] };
  assert.equal(rustSingleElidedInput([explicitlyBorrowed, input]), undefined);
});

test("owning storage constrains native inference without granting a borrowed-to-static conversion", () => {
  const source = promise(inferred);
  const target = substituteElidedLifetime(source, owned);
  assert.deepEqual(target, promise(owned));
  assert.equal(rustNativeRepresentationMatches(source, target), false);
  assert.deepEqual(substituteElidedLifetime(promise(borrowed), owned), promise(borrowed));
  const use = { node: {}, carrier: source, nativeStorageCarrier: target, requirements: ["static"] };
  assert.equal(requirementUseHasValidStorage(use), true);
  assert.equal(requirementUseHasValidStorage({ ...use, requirements: ["clone"] }), false);
  assert.equal(requirementUseHasValidStorage({ ...use, carrier: promise(borrowed) }), false);
  assert.equal(requirementUseHasValidStorage({ ...use, nativeStorageCarrier: promise(owned, rustSourcePrimitiveTargetType("uint64")) }), false);
});

test("retained invocation signatures name only their sole elided input lifetime", () => {
  const input = promise(inferred);
  const callback = { kind: "function-pointer", args: [{ kind: "reference", referent: rustUnitTargetType(), mutable: false }],
    result: rustUnitTargetType() };
  const result = { kind: "tuple", elements: [input, callback] };
  const bound = bindRustElidedCallableInput([callback, input], result, borrowed);
  assert.deepEqual(bound.parameters, [callback, promise(borrowed)]);
  assert.deepEqual(bound.result, { kind: "tuple", elements: [promise(borrowed), callback] });
  assert.equal(bound.parameterIndex, 1);
  assert.equal(bindRustElidedCallableInput([input, input], result, borrowed), undefined);
  assert.equal(bindRustElidedCallableInput([promise(owned)], result, borrowed), undefined);
  assert.equal(bindRustElidedCallableInput([promise(borrowed)], result, borrowed), undefined);
});

test("call result lifetimes follow the selected argument without changing payload or nested binders", () => {
  const input = promise(inferred);
  const instantiate = (actual, parameters = [input], result = input) =>
    instantiateRustElidedCallResult(result, parameters, [{ parameterIndex: 0, carrier: actual }]);
  assert.deepEqual(instantiate(promise(owned, rustAbsenceTargetType())), promise(owned));
  assert.deepEqual(instantiate(promise(borrowed)), promise(borrowed));
  assert.deepEqual(instantiate(input), input);
  assert.deepEqual(instantiate(promise(owned), [input, input]), input);
  assert.deepEqual(instantiate(promise(owned, rustSourcePrimitiveTargetType("int64"))), input);
  assert.deepEqual(instantiate(rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), owned, rustJsErrorTargetType())), input);
  assert.deepEqual(instantiate(promise({ kind: "call-scoped-elision", callIdentity: "call", parameterIdentity: "parameter" })), input);
  const callback = { kind: "function-pointer", args: [{ kind: "reference", referent: rustUnitTargetType(), mutable: false }],
    result: rustUnitTargetType() };
  assert.deepEqual(instantiate(promise(owned), [input], { kind: "tuple", elements: [input, callback] }),
    { kind: "tuple", elements: [promise(owned), callback] });
});

test("sealed source-call validation independently rechecks actual argument lifetime evidence", () => {
  const input = promise(inferred);
  const member = { id: "project::forward", targetName: "forward", kind: "method",
    parameters: [{ type: input, passingMode: "value" }], returnType: input };
  const binding = { sourceArgumentIndex: 0, sourceParameterIndex: 0, sourceForm: "value", sourceParameterForm: "required" };
  const selected = { member, sourceArgumentBindings: [binding] };
  const fact = { kind: "source-call", operationId: member.id,
    target: { form: "function", name: "forward", selectedTargetName: "forward", fileName: "/index.ts" },
    parameters: [{ form: "required", valueCarrier: input, parameterCarrier: input, mode: "value", inputs: [binding] }],
    resultCarrier: promise(owned) };
  const matches = (candidate, carrier, signature = selected) =>
    sourceCallSelectedMemberMatches(candidate, signature, member.returnType, type => type, undefined, [carrier]);
  assert.equal(matches(fact, promise(owned)), true);
  assert.equal(matches(fact, promise(borrowed)), false);
  assert.equal(matches(fact, undefined), false);
  assert.equal(matches(fact, input), false);
  assert.equal(matches(fact, promise(owned), { ...selected, sourceArgumentBindings: [] }), false);
  assert.equal(matches({ ...fact, resultCarrier: promise(owned, rustSourcePrimitiveTargetType("uint64")) }, promise(owned)), false);
});

test("named suspended callback input borrows never inherit the callback result's static lifetime", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const parameter = rustCallableInputTargetType([number], promise(owned, number), borrowed);
  const callback = rustCallableTargetType([number], promise(owned, number));
  const binding = { sourceArgumentIndex: 0, sourceParameterIndex: 0, sourceForm: "value", sourceParameterForm: "required" };
  const instantiate = (actual, bindings = [binding], physical = [{ inputLifetime: borrowed }]) =>
    rustSourceCallResultWithInputLifetimes(promise(borrowed, number), [parameter], bindings, [actual], physical);
  assert.deepEqual(instantiate(callback), promise(inferred, number));
  assert.deepEqual(instantiate(parameter), promise(borrowed, number));
  assert.deepEqual(instantiate({ ...parameter, lifetime: owned }), promise(owned, number));
  assert.deepEqual(instantiate(rustCallableTargetType([number], promise(owned))), promise(borrowed, number));
  assert.deepEqual(instantiate(undefined), promise(borrowed, number));
  assert.deepEqual(instantiate(callback, []), promise(borrowed, number));
  assert.deepEqual(instantiate(callback, [binding, binding]), promise(borrowed, number));
  assert.deepEqual(instantiate(callback, [binding], []), promise(borrowed, number));
  assert.deepEqual(instantiate(callback, [binding], [{ inputLifetime: { ...borrowed, identity: "foreign" } }]), promise(borrowed, number));
});

test("sealed callback input results reject deleted, foreign and payload-mutated lifetime evidence", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const parameter = rustCallableInputTargetType([number], promise(owned, number), borrowed);
  const callback = rustCallableTargetType([number], promise(owned, number));
  const binding = { sourceArgumentIndex: 0, sourceParameterIndex: 0, sourceForm: "value", sourceParameterForm: "required" };
  const member = { id: "project::invoke", targetName: "invoke", kind: "method",
    parameters: [{ type: parameter, passingMode: "value" }], returnType: promise(borrowed, number) };
  const selected = { member, sourceArgumentBindings: [binding] };
  const physical = { form: "required", valueCarrier: parameter, parameterCarrier: parameter, mode: "value",
    inputLifetime: borrowed, inputs: [{ ...binding, carrier: parameter }] };
  const fact = { kind: "source-call", operationId: member.id,
    target: { form: "function", name: "invoke", selectedTargetName: "invoke", fileName: "/index.ts" },
    parameters: [physical], resultCarrier: promise(inferred, number) };
  const matches = (candidate, actual = callback, signature = selected) =>
    sourceCallSelectedMemberMatches(candidate, signature, member.returnType, type => type, undefined, [actual]);
  assert.equal(matches(fact), true);
  const { inputLifetime, ...deleted } = physical;
  assert.equal(matches({ ...fact, parameters: [deleted] }), false);
  assert.equal(matches({ ...fact, parameters: [{ ...physical, inputLifetime: { ...inputLifetime, identity: "foreign" } }] }), false);
  assert.equal(matches({ ...fact, resultCarrier: promise(owned, number) }), false);
  assert.equal(matches({ ...fact, resultCarrier: promise(inferred) }), false);
  assert.equal(matches(fact, rustCallableTargetType([number], promise(owned))), false);
  assert.equal(matches(fact, callback, { ...selected, sourceArgumentBindings: [] }), false);
});

test("shared suspended callback input loans account for every actual reference in either order", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const parameter = rustCallableInputTargetType([], promise(owned, number), borrowed);
  const other = { kind: "parameter", identity: "scope::other", name: "other" };
  const actual = lifetime => ({ ...parameter, lifetime });
  const callback = rustCallableTargetType([], promise(owned, number));
  const bindings = [0, 1].map(index => ({ sourceArgumentIndex: index, sourceParameterIndex: index,
    sourceForm: "value", sourceParameterForm: "required" }));
  const instantiate = inputs => rustSourceCallResultWithInputLifetimes(promise(borrowed, number),
    [parameter, parameter], bindings, inputs, [{ inputLifetime: borrowed }, { inputLifetime: borrowed }]);
  for (const [left, right, expected] of [[actual(owned), actual(borrowed), borrowed],
    [actual(borrowed), actual(borrowed), borrowed], [actual(owned), actual(owned), owned],
    [actual(borrowed), actual(other), inferred], [callback, actual(borrowed), inferred]]) {
    assert.deepEqual(instantiate([left, right]), promise(expected, number));
    assert.deepEqual(instantiate([right, left]), promise(expected, number));
  }
});

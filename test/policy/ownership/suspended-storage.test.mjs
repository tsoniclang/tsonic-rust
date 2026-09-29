import assert from "node:assert/strict";
import test from "node:test";
import { selectRustCallableStorageLifetime, selectRustSuspendedStorageLifetime } from "../../../dist/policy/ownership/suspended-storage.js";
import { bindRustElidedCallableInput, instantiateRustElidedCallResult, rustSingleElidedInput } from "../../../dist/target-model/types/carriers/lifetime-elision.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustJsPromiseTargetTypeWithLifetime, rustUnitTargetType, rustAbsenceTargetType,
  rustSourcePrimitiveTargetType, rustJsErrorTargetType } from "../../../dist/target-model/types/index.js";
import { sourceCallSelectedMemberMatches } from "../../../dist/backend/planner/expressions/calls/arguments.js";

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
  assert.equal(rustSingleElidedInput([callback, input]), 1);
  const explicitlyBorrowed = { ...callback, args: [{ ...callback.args[0], lifetime: borrowed }] };
  assert.equal(rustSingleElidedInput([explicitlyBorrowed, input]), undefined);
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
    sourceCallSelectedMemberMatches(candidate, signature, member.returnType, type => type, [carrier]);
  assert.equal(matches(fact, promise(owned)), true);
  assert.equal(matches(fact, promise(borrowed)), false);
  assert.equal(matches(fact, undefined), false);
  assert.equal(matches(fact, input), false);
  assert.equal(matches(fact, promise(owned), { ...selected, sourceArgumentBindings: [] }), false);
  assert.equal(matches({ ...fact, resultCarrier: promise(owned, rustSourcePrimitiveTargetType("uint64")) }, promise(owned)), false);
});

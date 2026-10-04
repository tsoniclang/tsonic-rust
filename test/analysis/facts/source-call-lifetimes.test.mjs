import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceCallGenericLifetimeArguments } from "../../../dist/analysis/facts/source-call-lifetimes.js";
import { sourceCallSelectedMemberMatches } from "../../../dist/backend/planner/expressions/calls/arguments.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";

const declared = { kind: "parameter", identity: "read::lifetime", name: "Region" };
const actual = { kind: "parameter", identity: "caller::lifetime", name: "Region" };
const elided = { kind: "call-scoped-elision", callIdentity: "call", parameterIdentity: "read::lifetime" };
const integer = { kind: "source-primitive", name: "int32" };
const reference = lifetime => ({ kind: "reference", referent: integer, lifetime, mutable: false });
const argument = lifetime => ({ kind: "lifetime", lifetime });
const binding = { sourceArgumentIndex: 0, sourceParameterIndex: 0, sourceForm: "value", sourceParameterForm: "required" };
const member = { id: "source::read", targetName: "read", kind: "method", returnType: reference(declared),
  genericParameters: [{ kind: "lifetime", sourceName: "Region", targetIdentity: rustLifetimeKey(declared) }],
  parameters: [{ type: reference(declared), passingMode: "value" }] };
const selected = { member, sourceArgumentBindings: [binding], targetGenericArguments: [argument(elided)],
  sourceSelectedMethodTypeArguments: [{ typeParameterName: "Region", typeParameter: {}, selectedType: {} }] };
const finalize = (carriers, signature = selected) =>
  rustSourceCallGenericLifetimeArguments(signature, signature.targetGenericArguments, index => carriers[index]);

test("lifetime finalization resolves inputs only when an omitted native lifetime demands them", () => {
  let queries = 0;
  const lookup = () => { queries += 1; return reference(actual); };
  const ordinary = { member: { parameters: [{ type: integer }] }, sourceArgumentBindings: [binding] };
  assert.deepEqual(rustSourceCallGenericLifetimeArguments(ordinary, [], lookup), []);
  assert.equal(queries, 0);
  const explicit = { ...selected, sourceSelectedMethodTypeArguments: [{
    ...selected.sourceSelectedMethodTypeArguments[0], explicitTypeNode: {},
  }] };
  assert.deepEqual(rustSourceCallGenericLifetimeArguments(explicit, explicit.targetGenericArguments, lookup), [argument(elided)]);
  assert.equal(queries, 0);
  assert.deepEqual(rustSourceCallGenericLifetimeArguments(selected, selected.targetGenericArguments, lookup), [argument(actual)]);
  assert.equal(queries, 1);
});

test("omitted generic lifetimes bind exact input identity, not spelling or a global lifetime conversion", () => {
  assert.deepEqual(finalize([reference(actual)]), [argument(actual)]);
  assert.deepEqual(finalize([reference({ kind: "static" })]), [argument({ kind: "static" })]);
  assert.deepEqual(finalize([reference(undefined)]), [argument(elided)]);
  assert.deepEqual(finalize([reference({ kind: "placeholder" })]), [argument(elided)]);
  assert.deepEqual(finalize([reference(actual)], { ...selected,
    sourceSelectedMethodTypeArguments: [{ ...selected.sourceSelectedMethodTypeArguments[0], explicitTypeNode: {} }] }), [argument(elided)]);
  assert.deepEqual(finalize([{ ...reference(actual), mutable: true }]), [argument(elided)]);
  assert.deepEqual(finalize([{ ...reference(actual), referent: { kind: "source-primitive", name: "uint32" } }]), [argument(elided)]);
  assert.deepEqual(finalize([reference(actual)], { ...selected, sourceArgumentBindings: [] }), [argument(elided)]);
});

test("input lifetime inference combines all exact bindings and preserves distinct generic identities", () => {
  const repeated = { ...selected, member: { ...member, parameters: [...member.parameters, ...member.parameters] },
    sourceArgumentBindings: [binding, { ...binding, sourceArgumentIndex: 1, sourceParameterIndex: 1 }] };
  assert.deepEqual(finalize([reference(actual), reference(actual)], repeated), [argument(actual)]);
  assert.equal(finalize([reference(actual), reference({ ...actual, identity: "other" })], repeated), undefined);
  assert.deepEqual(finalize([{ kind: "tuple", elements: [reference(actual)] }], { ...selected,
    sourceArgumentBindings: [{ ...binding, sourceForm: "spread-element", spreadElementIndex: 0 }] }), [argument(actual)]);
  const second = { kind: "parameter", identity: "second", name: "Other" };
  const secondElision = { ...elided, parameterIdentity: "second" };
  const distinct = { ...repeated, member: { ...repeated.member,
    genericParameters: [...member.genericParameters, { kind: "lifetime", sourceName: "Other", targetIdentity: rustLifetimeKey(second) }],
    parameters: [...member.parameters, { type: reference(second), passingMode: "value" }] },
    targetGenericArguments: [argument(elided), argument(secondElision)],
    sourceSelectedMethodTypeArguments: [...selected.sourceSelectedMethodTypeArguments, { typeParameterName: "Other", typeParameter: {}, selectedType: {} }] };
  assert.deepEqual(finalize([reference(actual), reference({ kind: "static" })], distinct), [argument(actual), argument({ kind: "static" })]);
});

test("the backend independently rejects stale, missing and widened generic lifetime evidence", () => {
  const carrier = reference(actual);
  const fact = { kind: "source-call", operationId: member.id,
    target: { form: "function", name: "read", selectedTargetName: "read", fileName: "/index.ts" },
    parameters: [{ form: "required", valueCarrier: carrier, parameterCarrier: carrier, mode: "value", inputs: [binding] }],
    resultCarrier: carrier, targetGenericArguments: [argument(actual)] };
  const matches = (candidate, input = carrier, signature = selected) =>
    sourceCallSelectedMemberMatches(candidate, signature, member.returnType, type => type, undefined, [input]);
  assert.equal(matches(fact), true);
  assert.equal(matches(fact, reference({ ...actual, identity: "other" })), false);
  assert.equal(matches(fact, reference(undefined)), false);
  assert.equal(matches(fact, carrier, { ...selected, sourceArgumentBindings: [] }), false);
  const widened = reference({ kind: "static" });
  assert.equal(matches({ ...fact, resultCarrier: widened, targetGenericArguments: [argument({ kind: "static" })],
    parameters: [{ ...fact.parameters[0], valueCarrier: widened, parameterCarrier: widened }] }), false);
});

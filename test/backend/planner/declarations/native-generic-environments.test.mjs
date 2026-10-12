import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeCallableGenerics } from "../../../../dist/backend/planner/declarations/callables/native-generics.js";
import { rustCallablePayloadContext } from "../../../../dist/backend/planner/expressions/capture-payloads.js";
import { nativeProducerFixture } from "../../../helpers/native-producer-bridges.mjs";

function fixture(substitutions = new Map()) {
  const { context, protocol } = nativeProducerFixture({ result: { kind: "source-primitive", name: "float64" } });
  const declaration = {};
  const implementation = { kind: "type-parameter", identity: "exact-input-1", name: "Implementation" };
  const input = { implementation, protocol };
  const original = context.input.program.callableValues.native;
  context.input.program.callableValues.native = { ...original,
    inputsFor: owner => owner === declaration ? [input] : [], capturesFor: () => [],
    callFor: node => node === declaration ? { input } : undefined };
  context.input.program.callableValues.nativeGenericProducers.forwardingFor = () => [];
  context.input.program.source = { ast: { forEachChild() {} } };
  context.input.program.facts = { getFact() {} };
  context.typeParameterSubstitutions = substitutions;
  const source = { context, sourceTypeParameterIdentities: [], preservesExplicitLifetimes: false,
    finalizeGenerics: () => ({ parameters: [], wherePredicates: [] }) };
  return { declaration, implementation, input, source };
}

test("native generic implementation parameters are not redeclared after exact environment substitution", () => {
  const capture = { kind: "type-parameter", identity: "physical-capture", name: "Captured" };
  const current = fixture(new Map([["exact-input-1", capture]]));
  const selected = planRustNativeCallableGenerics(current.declaration, current.source);
  assert.equal(selected !== undefined, true);
  const generics = selected.finalizeGenerics();
  assert.equal(generics.parameters.length, 0);
  assert.equal(generics.wherePredicates.length, 1);
  assert.equal(generics.wherePredicates[0].type.path, "Captured");
  assert.equal(generics.wherePredicates[0].bounds[0].reference.trait.path,
    `crate::proof::${current.input.protocol.targetName}`);
});

test("unsubstituted native input still declares its own exact generic parameter", () => {
  const current = fixture();
  const selected = planRustNativeCallableGenerics(current.declaration, current.source);
  assert.equal(selected !== undefined, true);
  const generics = selected.finalizeGenerics();
  assert.equal(generics.parameters.length, 1);
  assert.equal(generics.parameters[0].name, "Implementation");
  assert.equal(generics.parameters[0].bounds.length, 1);
  assert.equal(generics.wherePredicates.length, 0);
});

test("callable payload bindings retain exact selected physical carriers without changing capture storage", () => {
  const current = fixture();
  const logical = { kind: "source-primitive", name: "float64" };
  const physical = current.implementation;
  const capture = { declaration: {}, reference: {}, carrier: logical, storageCarrier: physical, storage: "value" };
  const selected = rustCallablePayloadContext({ captures: [capture], receiverFields: [], receivers: [] },
    { kind: "path", path: "environment" }, current.source.context);
  assert.equal(selected.capturedBindings[0].valueCarrier === physical, true);
  assert.equal(selected.capturedBindings[0].storage, capture.storage);
  assert.equal(selected.capturedBindings[0].declaration === capture.declaration, true);
  assert.equal(capture.carrier === logical, true);
});

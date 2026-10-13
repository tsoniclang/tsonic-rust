import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { planRustNativeCallableGenerics } from "../../../../dist/backend/planner/declarations/callables/native-generics.js";
import { rustCallablePayloadContext } from "../../../../dist/backend/planner/expressions/capture-payloads.js";
import { nativeProducerFixture } from "../../../helpers/native-producer-bridges.mjs";



function fixture(substitutions = new Map()) {
  const { context, protocol } = nativeProducerFixture({ result: { kind: "source-primitive", name: "float64" } });
  const declaration = {};
  const implementation = { kind: "type-parameter", identity: "exact-input-1", name: "Implementation" };
  const input = { implementation, protocol, trait: protocol.trait };
  const original = context.input.program.callableValues.native;
  context.input.program.callableValues.native = { ...original,
    inputsFor: owner => owner === declaration ? [input] : [], capturesFor: () => [],
    callFor: node => node === declaration ? { input } : undefined };
  context.input.program.callableValues.nativeGenericProducers.forwardingFor = () => [];
  context.input.program.callableValues.nativeStorage = {
    futureEnvironmentFor: () => ({ kind: "resolved", inputs: [], captures: [] }),
  };
  context.input.program.source = { ast: { forEachChild() {} } };
  context.input.program.records = createRustRecordFixture();
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

for (const position of ["return", "conversion"]) {
  test(`native generic bounds include associated types in physical ${position} storage without an authored call`, () => {
    const current = fixture();
    const program = current.source.context.input.program;
    program.callableValues.native.callFor = () => undefined;
    const trait = current.input.protocol.trait;
    const carrier = { kind: "associated-type", owner: current.implementation, name: "InvocationError", trait };
    program.callableValues.nativeStorage = {
      ...program.callableValues.nativeStorage,
      returnFor: () => ({ kind: "selected", carrier, inputs: [current.input] }),
      valueFor: () => ({ kind: "selected", carrier, inputs: [current.input] }),
    };
    program.records = createRustRecordFixture({
      sourceCallableReturn: { get: node => node === current.declaration && position === "return"
        ? { returnCarrier: carrier } : undefined },
      contextualValueConversion: { get: node => node === current.declaration && position === "conversion"
        ? { conversion: { kind: "callable-adapter" } } : undefined },
    });
    const selected = planRustNativeCallableGenerics(current.declaration, current.source);
    assert.equal(selected !== undefined, true);
    const parameters = selected.finalizeGenerics().parameters;
    assert.equal(parameters.length, 1);
    assert.equal(parameters[0].bounds.length, 1);
    assert.equal(parameters[0].bounds[0].reference.trait.path, `crate::proof::${current.input.protocol.targetName}`);
    program.callableValues.nativeStorage.returnFor = program.callableValues.nativeStorage.valueFor =
      () => ({ kind: "unresolved", reason: "missing exact physical selection" });
    assert.equal(planRustNativeCallableGenerics(current.declaration, current.source) === undefined, true,
      "unresolved physical requirements cannot silently omit the native bound");
  });
}

test("native generic bounds do not invent obligations for unused inputs", () => {
  const current = fixture();
  current.source.context.input.program.callableValues.native.callFor = () => undefined;
  const selected = planRustNativeCallableGenerics(current.declaration, current.source);
  assert.equal(selected !== undefined, true);
  assert.equal(selected.finalizeGenerics().parameters[0].bounds.length, 0);
});

test("unobserved Future inputs and captures declare exact implementation parameters without callable or output bounds", () => {
  const current = fixture();
  const program = current.source.context.input.program;
  program.callableValues.native.inputsFor = () => [];
  program.callableValues.native.callFor = () => undefined;
  const first = { implementation: { kind: "type-parameter", identity: "future:first", name: "Future0" } };
  const second = { implementation: { kind: "type-parameter", identity: "future:second", name: "Future0" } };
  program.callableValues.nativeStorage.futureEnvironmentFor = () => ({ kind: "resolved", inputs: [first], captures: [first, second] });
  const selected = planRustNativeCallableGenerics(current.declaration, current.source);
  assert.equal(selected !== undefined, true);
  const generics = selected.finalizeGenerics();
  assert.equal(generics.parameters.length, 2, "a repeated input capture remains one exact implementation");
  assert.equal(new Set(generics.parameters.map(parameter => parameter.name)).size, 2, "independent inputs cannot share a generated name");
  assert.equal(generics.parameters.every(parameter => parameter.bounds.length === 0), true, "transport does not impose Future<Output=Result<T,E>>");
  assert.equal(generics.wherePredicates.length, 0);
});

test("substituted Future captures are not redeclared or constrained merely for transport", () => {
  const current = fixture(new Map([["future:captured", { kind: "type-parameter", identity: "outer", name: "Outer" }]]));
  const program = current.source.context.input.program;
  program.callableValues.native.inputsFor = () => [];
  program.callableValues.native.callFor = () => undefined;
  program.callableValues.nativeStorage.futureEnvironmentFor = () => ({ kind: "resolved", inputs: [], captures: [{ implementation: {
    kind: "type-parameter", identity: "future:captured", name: "Future0",
  } }] });
  const selected = planRustNativeCallableGenerics(current.declaration, current.source);
  assert.equal(selected !== undefined, true);
  assert.equal(selected.finalizeGenerics().parameters.length, 0);
  assert.equal(selected.finalizeGenerics().wherePredicates.length, 0);
});

test("unresolved Future environments reject without silently omitting implementation parameters", () => {
  const current = fixture();
  current.source.context.input.program.callableValues.nativeStorage.futureEnvironmentFor = () => ({
    kind: "unresolved", reason: "missing exact capture identity",
  });
  assert.equal(planRustNativeCallableGenerics(current.declaration, current.source) === undefined, true);
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

import assert from "node:assert/strict";
import test from "node:test";
import { createRustNativeCallableProtocolRegistry } from "../../../dist/analysis/callables/native-protocols.js";
import { analyzeRustNativeProducerBridge } from "../../../dist/analysis/callables/native-producer-bridges.js";
import { rustCallableTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustNativeCallableErrorType, selectRustNativeCallableProtocolResult } from "../../../dist/policy/types/callables/native-protocols.js";
import { rustNativeCallableInputPhysicalSignature } from "../../../dist/policy/conversions/native-callables.js";
import { rustNativeCallableInvocationArguments } from "../../../dist/policy/types/callables/native-invocations.js";
import { rustTargetTypeRefEquals, rustTargetGenericArgumentEquals } from "../../../dist/target-model/types/equality.js";
import { rustGenericCallableEnvironmentGenerics } from "../../../dist/backend/planner/declarations/callables/generic-signatures.js";

function fixture() {
  const value = Object.freeze({ kind: "type-parameter", identity: "source:value", name: "Value" });
  const registry = createRustNativeCallableProtocolRegistry({ definitions: emptyRustTypeDefinitions, usedNames: new Set(),
    structuralShapes: { instantiateSourceCarrier() { assert.fail("the primitive environment fixture has no structural output"); } } });
  const binding = registry.bind("/source.ts", rustCallableTargetType([value], value));
  assert.equal(binding !== undefined, true, "the original callable signature has its canonical native protocol");
  return { value, binding, registry };
}

test("native protocol environments publish one immutable formal and actual generic argument vector", () => {
  const { value, binding } = fixture();
  const formal = binding.protocol.environmentParameters;
  assert.equal(formal.length === 1 && formal[0].kind === "type", true, "the native item owns one typed formal environment argument");
  assert.equal(rustTargetTypeRefEquals(formal[0].type, binding.protocol.signature.environmentParameters[0]), true,
    "the source signature type and native formal preserve their identical canonical binder");
  assert.equal(binding.environment.length === 1 && binding.environment[0].kind === "type", true,
    "the actual environment uses the same required argument vocabulary");
  assert.equal(rustTargetTypeRefEquals(binding.environment[0].type, value), true, "the actual source type identity is retained");
  assert.equal(Object.isFrozen(formal) && Object.isFrozen(formal[0]) && Object.isFrozen(binding.environment) &&
    Object.isFrozen(binding.environment[0]), true, "neither published argument inventory admits mutation");
  assert.equal(rustTargetGenericArgumentEquals(binding.trait.genericArguments[0], binding.environment[0]), true,
    "the native trait and its binding preserve the exact same actual argument metadata");
});

test("native protocol physical and invocation binding preserve item lifetime arguments separately from method binders", () => {
  const { binding } = fixture();
  const formalLifetime = Object.freeze({ kind: "parameter", identity: "native:environment", name: "environment" });
  const actualLifetime = Object.freeze({ kind: "parameter", identity: "caller:environment", name: "caller" });
  const formal = Object.freeze([{ kind: "lifetime", lifetime: formalLifetime }, ...binding.protocol.environmentParameters]);
  const actual = Object.freeze([{ kind: "lifetime", lifetime: actualLifetime }, { kind: "type", type: rustSourcePrimitiveTargetType("int32") }]);
  const reference = Object.freeze({ kind: "reference", mutable: false, lifetime: formalLifetime, referent: formal[1].type });
  const protocol = { ...binding.protocol, environmentParameters: formal,
    trait: { ...binding.protocol.trait, genericArguments: formal },
    method: { ...binding.protocol.method, parameters: [reference], result: reference, sourceResult: reference } };
  protocol.result = selectRustNativeCallableProtocolResult(protocol, emptyRustTypeDefinitions);
  assert.equal(protocol.result !== undefined, true, "the existing result owner accepts the full canonical native environment");
  const input = { ...binding, protocol, environment: actual, trait: { ...protocol.trait, genericArguments: actual },
    implementation: { kind: "type-parameter", identity: "input:implementation", name: "Implementation" } };
  const expected = { ...reference, lifetime: actualLifetime, referent: actual[1].type };
  const selected = rustNativeCallableInputPhysicalSignature(input, []);
  assert.equal(selected !== undefined && selected.parameters.length === 1, true, "the one native parameter is physically bound");
  assert.equal(rustTargetTypeRefEquals(selected.parameters[0], expected), true, "item lifetime and type arguments both reach the physical input");
  assert.equal(rustTargetTypeRefEquals(selected.result, expected), true, "the native result preserves the actual named lifetime without static promotion");
  assert.equal(protocol.method.binder.parameters.length, 0, "an item environment lifetime is not an invocation higher-ranked binder");
  const arguments_ = rustNativeCallableInvocationArguments(input, { kind: "source-call", parameters: [{ parameterCarrier: expected }],
    resultCarrier: expected }, "exact:invocation");
  assert.equal(arguments_ !== undefined && arguments_.length === 0, true, "the selected item environment adds no invented method arguments");
  const error = rustNativeCallableErrorType(input, input.implementation, "invocation", []);
  assert.equal(error !== undefined && error.trait === input.trait, true, "the associated error keeps its exact lifetime-aware native trait");
  const bridge = analyzeRustNativeProducerBridge(protocol, emptyRustTypeDefinitions);
  assert.equal(bridge !== undefined && bridge.genericArguments[0].kind === "lifetime", true,
    "the existing producer bridge declares the exact native item lifetime before its type parameters");
  assert.equal(bridge.genericArguments[0].lifetime === formalLifetime, true, "the bridge does not infer or replace its owning lifetime");
  const generics = rustGenericCallableEnvironmentGenerics(protocol.environmentParameters, {});
  assert.equal(generics.parameters.length === 2 && generics.parameters[0].kind === "lifetime" &&
    generics.parameters[1].kind === "type", true, "the same existing renderer consumes both native environment argument kinds");
  assert.equal(generics.parameters[0].name, formalLifetime.name, "the item lifetime spelling comes from selected native metadata");
});

test("native protocol consumers reject old type-only payloads and wrong environment argument kinds or arity", () => {
  const { value, binding } = fixture();
  const implementation = { kind: "type-parameter", identity: "input:implementation", name: "Implementation" };
  for (const environment of [[value], [], [{ kind: "lifetime", lifetime: { kind: "static" } }],
    [...binding.environment, ...binding.environment]]) {
    const input = { ...binding, implementation, environment, trait: { ...binding.trait, genericArguments: environment } };
    assert.equal(rustNativeCallableInputPhysicalSignature(input, []) === undefined, true,
      "the native physical signature requires one exact kind-correct actual environment vector");
    assert.equal(rustNativeCallableErrorType(input, implementation, "invocation", []) === undefined, true,
      "the associated error does not accept an incompatible native trait environment");
    assert.equal(rustNativeCallableInvocationArguments(input, { kind: "source-call", parameters: [{ parameterCarrier: value }],
      resultCarrier: value }, "invalid:environment") === undefined, true,
    "the native invocation cannot recover an old or malformed environment from source type positions");
  }
});

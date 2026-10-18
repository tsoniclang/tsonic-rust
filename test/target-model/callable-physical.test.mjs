import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableConversionPhysical, rustCallableConversionErrorArities, rustCallablePhysicalSignature, substituteRustCallablePhysicalConversion }
  from "../../dist/target-model/conversions/callable-physical.js";
import { selectRustCallableConversion } from "../../dist/target-model/conversions/callable.js";
import { selectRustExactIntegerConversion } from "../../dist/target-model/conversions/exact-integer.js";
import { rustCallableTargetType, rustCallableInputTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetId, rustInfallibleTargetId, rustOptionTargetId } from "../../dist/target-model/types/carriers/source-types.js";
import { rustFutureTargetType } from "../../dist/target-model/types/carriers/primitives.js";
import { rustOptionTargetType } from "../../dist/target-model/types/carriers/optional.js";
import { rustNativeErrorJoinReference } from "../../dist/target-model/types/native-error-joins.js";
import { rustRuntimeErrorTargetType } from "../../dist/target-model/operations/error-boundary.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { rustNativeCompletionFutureType } from "../../dist/target-model/types/callable-completions.js";
import { substituteRustTargetGenerics } from "../../dist/target-model/types/carriers/substitution.js";
import { emptyRustTypeDefinitions } from "../../dist/target-model/types/source-union-definitions.js";
import { rustNativeCallableAbi, selectRustNativeCallableTypeCarrier, selectRustNativeTypeCarrier }
  from "../../dist/policy/types/model/native-type-selection.js";

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

test("the canonical native callable ABI preserves runtime aliases and producer-specific errors separately", () => {
  const logical = rustCallableTargetType([integer], wide);
  const signature = rustNativeCallableAbi({ kind: "logical", carrier: logical });
  assert.equal(signature?.kind, "stored", "the original stored ABI is selected once");
  assert.equal(signature.runtimeResult, true, "the authored callable uses the existing TsonicResult contract");
  assert.equal(rustTargetTypeRefEquals(signature.error, rustRuntimeErrorTargetType()), true, "the runtime result has its exact error ABI");
  const physical = physicalCarrier({ parameters: [integer], result: wide, error: failure });
  assert.equal(rustNativeCallableAbi({ kind: "logical", carrier: physical }) === undefined, true,
    "physical metadata is not reinterpreted as a logical stored signature");
  assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical).error, failure), true,
    "producer-specific error identity is never replaced by the runtime alias");
  const nested = select(rustCallableTargetType([], logical),
    rustCallableTargetType([], rustCallableTargetType([integer, integer], wide)));
  const selected = rustCallableConversionPhysical(nested, { parameters: [], result: logical, error: failure }, file,
    emptyRustTypeDefinitions, carrier => {
      const inner = rustNativeCallableAbi({ kind: "logical", carrier });
      return inner === undefined ? undefined : { parameters: inner.parameters, result: inner.result, error: inner.error };
    });
  assert.equal(selected?.resultPlan.kind, "callable", "the original ABI decoder owns nested logical results");
  assert.equal(rustTargetTypeRefEquals(selected.source.error, failure), true, "the outer producer retains its original native error");
  assert.equal(rustTargetTypeRefEquals(selected.resultPlan.conversion.source.error, rustRuntimeErrorTargetType()), true,
    "the nested stored contract retains its own runtime error");
  const input = { typeDefinitions: emptyRustTypeDefinitions, typeParameterNames: undefined,
    pathFor: () => undefined, additionalArgumentsFor: () => undefined, programErrorCarrier: () => undefined,
    producerErrorCarrier: () => undefined, nativeErrorJoinCarrier: () => undefined, structuralCarrier: () => undefined };
  const native = selectRustNativeTypeCarrier(logical, input, "general");
  assert.equal(native.kind, "resolved", "the same selector renders the admitted stored ABI");
  assert.equal(native.carrier.value.genericArguments[2].type.value.path, "rt::TsonicResult", "native syntax keeps its original result alias");
  const nativeAlias = rustNativeCallableAbi({ kind: "physical", carrier: native.carrier });
  const nativeProducer = rustNativeCallableAbi({ kind: "physical", carrier: physical });
  assert.equal(nativeAlias !== undefined && nativeProducer !== undefined, true,
    "only the explicit physical contract decodes the actual selected emitted slots");
  assert.equal(rustTargetTypeRefEquals(nativeAlias.result, wide), true, "the selected runtime alias preserves its native result");
  assert.equal(rustTargetTypeRefEquals(nativeAlias.error, rustRuntimeErrorTargetType()), true,
    "rt::TsonicResult retains its exact runtime error, not a requested producer error");
  assert.equal(rustTargetTypeRefEquals(nativeProducer.error, failure), true,
    "Result retains its original producer-specific native error identity");
  assert.equal(rustNativeCallableAbi({ kind: "physical", carrier: logical }) === undefined, true,
    "the physical contract cannot relabel raw logical storage as selected native ABI");
  assert.equal(rustNativeCallableAbi(logical) === undefined && rustNativeCallableAbi(physical) === undefined, true,
    "the superseded raw-carrier API has no compatibility overload");
  for (const [label, result] of [
    ["foreign alias identity", rustNamedTargetType("fixture:OtherResult", "rt::TsonicResult", [
      { kind: "type", type: wide },
    ], [], undefined, [], undefined, [])],
    ["extra runtime error argument", rustNamedTargetType("rust.runtime.TsonicResult", "rt::TsonicResult", [
      { kind: "type", type: wide }, { kind: "type", type: failure },
    ], [], undefined, [], undefined, [])],
    ["missing native error argument", rustNamedTargetType("rust.core.Result", "Result", [
      { kind: "type", type: wide },
    ], [], undefined, [], undefined, [])],
  ]) {
    const selected = rustNamedTargetType(rustCallableTargetId, "rt::Callable", [
      native.carrier.value.genericArguments[0], native.carrier.value.genericArguments[1], { kind: "type", type: result },
    ], [], undefined, [], undefined, []);
    assert.equal(rustNativeCallableAbi({ kind: "physical", carrier: selected }) === undefined, true,
      `${label}: names or arity cannot manufacture a different native result contract`);
  }
  const borrowed = rustNativeCallableAbi({ kind: "logical", carrier: rustCallableInputTargetType([integer], wide) });
  assert.equal(borrowed?.kind, "input", "native input and storage use the same owner with distinct native contracts");
  assert.equal(borrowed.binder.parameters.length, 0, "a non-borrowing input never invents a higher-ranked binder");
});

test("prepared declared callable ABI publishes through the same native type owner without choosing its error again", () => {
  const input = { typeDefinitions: emptyRustTypeDefinitions, typeParameterNames: undefined,
    pathFor: () => undefined, additionalArgumentsFor: () => undefined, programErrorCarrier: () => undefined,
    producerErrorCarrier: () => undefined, nativeErrorJoinCarrier: () => undefined, structuralCarrier: () => undefined };
  for (const [label, logical] of [["runtime alias", rustCallableTargetType([integer], wide)],
    ["native producer error", rustCallableTargetType([integer], wide, { kind: "static" }, failure)]]) {
    const abi = rustNativeCallableAbi({ kind: "logical", carrier: logical });
    assert.equal(abi?.kind, "stored", `${label}: complete declared storage ABI is selected before native publication`);
    const original = selectRustNativeTypeCarrier(logical, input, "general");
    const published = selectRustNativeCallableTypeCarrier(logical, logical, abi, input, "general");
    assert.equal(original.kind, "resolved", `${label}: retained native declaration is representable`);
    assert.equal(published.kind, "resolved", `${label}: native syntax consumes the prepared signature`);
    assert.equal(rustTargetTypeRefEquals(original.carrier, published.carrier), true,
      `${label}: prepared and direct entrypoints share the same grammar and native result identity`);
    assert.equal(rustTargetTypeRefEquals(published.carrier, published.payloadCarrier), true,
      `${label}: an unwrapped field has the same full carrier and exact callable payload`);
    const physical = rustNativeCallableAbi({ kind: "physical", carrier: published.payloadCarrier });
    assert.equal(rustTargetTypeRefEquals(physical.error, abi.error), true,
      `${label}: the originally selected declared error is not replaced by a requested adapter target`);
  }
  const logical = rustCallableTargetType([integer], { kind: "opaque", id: "missing:field-output" });
  const abi = rustNativeCallableAbi({ kind: "logical", carrier: logical });
  assert.equal(selectRustNativeCallableTypeCarrier(logical, logical, abi, input, "general").kind, "rejected",
    "prepared ABI cannot invent missing native child metadata");
  const borrowed = rustCallableInputTargetType([integer], wide);
  const inputAbi = rustNativeCallableAbi({ kind: "logical", carrier: borrowed });
  assert.equal(selectRustNativeCallableTypeCarrier(borrowed, borrowed, inputAbi, input, "general").kind, "rejected",
    "an invocation-only input is not silently accepted as a stored field ABI");
});

test("prepared field callable completion retains every original optional container and its exact selected leaf", () => {
  const input = { typeDefinitions: emptyRustTypeDefinitions, typeParameterNames: undefined,
    pathFor: () => undefined, additionalArgumentsFor: () => undefined, programErrorCarrier: () => undefined,
    producerErrorCarrier: () => undefined, nativeErrorJoinCarrier: () => undefined, structuralCarrier: () => undefined };
  const payload = rustCallableTargetType([integer], wide);
  const abi = rustNativeCallableAbi({ kind: "logical", carrier: payload });
  for (const [label, container, depth] of [["required", payload, 0], ["optional", rustOptionTargetType(payload), 1],
    ["nested original option", rustOptionTargetType(rustOptionTargetType(payload)), 2]]) {
    const selected = selectRustNativeCallableTypeCarrier(container, payload, abi, input, "general");
    assert.equal(selected.kind, "resolved", `${label}: exact original field container is admitted`);
    let native = selected.carrier;
    for (let index = 0; index < depth; index += 1) {
      const wrapper = rustNamedTypeCarrierValue(native);
      assert.equal(wrapper?.id, rustOptionTargetId, `${label}: original native wrapper ${index} survives publication`);
      assert.equal(wrapper.genericArguments.length, 1, `${label}: wrapper ${index} has its exact one payload`);
      assert.equal(wrapper.genericArguments[0].kind, "type", `${label}: wrapper ${index} retains its native type argument`);
      native = wrapper.genericArguments[0].type;
    }
    assert.equal(rustTargetTypeRefEquals(native, selected.payloadCarrier), true,
      `${label}: published leaf is the same canonical callable ABI, not the entire optional slot`);
    assert.equal(rustNativeCallableAbi({ kind: "physical", carrier: selected.payloadCarrier }) !== undefined, true,
      `${label}: the selected callable payload has its exact physical signature`);
  }
  const sameTypeDifferentLeaf = rustCallableTargetType([integer], wide);
  assert.equal(selectRustNativeCallableTypeCarrier(rustOptionTargetType(payload), sameTypeDifferentLeaf, abi, input, "general").kind,
    "rejected", "equal-looking foreign payloads cannot replace the exact original selected field leaf");
  assert.equal(selectRustNativeCallableTypeCarrier(integer, payload, abi, input, "general").kind, "rejected",
    "a missing original callable payload is not silently selected outside its container");
});

test("physical adapters preserve source error and native Future payload without ambient substitution", () => {
  const future = rustFutureTargetType(integer);
  const selected = select(rustCallableTargetType([], future), rustCallableTargetType([integer], future));
  const native = rustNativeCompletionFutureType({ identity: "fixture:Future", output: integer, error: failure, captures: [] });
  for (const error of [infallible, failure]) {
    const physical = rustCallableConversionPhysical(selected, { parameters: [], result: native, error }, file,
      emptyRustTypeDefinitions, rustCallablePhysicalSignature);
    assert.equal(physical !== undefined, true);
    assert.equal(Object.hasOwn(physical, "nativeErrorType"), false, "private physical preparation is not a fabricated native admission");
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

test("physical adapter substitution preserves selected nested contracts and every error channel", () => {
  const parameter = { kind: "type-parameter", identity: "fixture:Value", name: "Value" };
  const nativeError = rustNamedTargetType("fixture:GenericError", "GenericError", [{ kind: "type", type: parameter }],
    [], undefined, [], undefined, []);
  const selected = select(rustCallableTargetType([], parameter), rustCallableTargetType([integer], parameter));
  const prepared = rustCallableConversionPhysical(selected, { parameters: [], result: parameter, error: nativeError }, file,
    emptyRustTypeDefinitions, rustCallablePhysicalSignature);
  assert.equal(prepared !== undefined, true, "the exact generic physical adapter is selected once");
  const bindings = { types: new Map([[parameter.identity, wide]]), lifetimes: new Map(), consts: new Map() };
  const apply = carrier => carrier === parameter ? wide : substituteRustTargetGenerics(carrier, bindings.types, bindings.lifetimes, bindings.consts);
  const substituted = substituteRustCallablePhysicalConversion(prepared, bindings, apply);
  assert.equal(rustTargetTypeRefEquals(substituted.result, wide), true, "result uses the actual physical context");
  assert.equal(substituted.errors[0].identity, prepared.errors[0].identity, "source error identity is unchanged");
  assert.equal(substituted.errors[0].variant, prepared.errors[0].variant, "source variant is unchanged");
  assert.equal(rustTargetTypeRefEquals(substituted.errors[0].errorType, apply(nativeError)), true, "full selected native error arguments survive");
  assert.equal(rustTargetTypeRefEquals(prepared.result, parameter), true, "early selected evidence remains immutable");
  assert.equal(Object.hasOwn(substituted, "nativeErrorType"), false, "substitution never pretends to admit native syntax");
});

test("fallible argument and result adapters expose canonical distinct exact error channels", () => {
  const selected = select(rustCallableTargetType([integer], wide), rustCallableTargetType([wide], integer));
  const physical = rustCallableConversionPhysical(selected, { parameters: [integer], result: wide, error: failure }, file,
    emptyRustTypeDefinitions, rustCallablePhysicalSignature);
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
    { parameters: [], result: physicalCarrier(nested), error: infallible }, file,
    emptyRustTypeDefinitions, rustCallablePhysicalSignature);
  assert.equal(physical !== undefined, true);
  assert.equal(physical.resultPlan.kind, "callable");
  assert.equal(rustTargetTypeRefEquals(physical.error, infallible), true, "constructing the nested adapter is infallible");
  assert.equal(rustTargetTypeRefEquals(physical.resultPlan.conversion.source.error, failure), true);
  assert.equal(rustNativeErrorJoinReference(rustCallablePhysicalSignature(physical.result).error).errors.length, 2);
  assert.deepEqual(rustCallableConversionErrorArities(selected), [2]);
});

test("borrowed input adapters expose native tuple closure and exact Result without owning storage", () => {
  const selected = select(rustCallableTargetType([], integer), rustCallableInputTargetType([integer], integer));
  const physical = rustCallableConversionPhysical(selected, { parameters: [], result: integer, error: failure }, file,
    emptyRustTypeDefinitions, rustCallablePhysicalSignature);
  assert.equal(physical !== undefined, true);
  assert.equal(physical.carrier.kind, "closure");
  assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).error, failure), true);
});

test("physical adapter validation rejects malformed selections and inconsistent exact inputs", () => {
  const selected = select(rustCallableTargetType([integer], wide), rustCallableTargetType([wide], integer));
  const actual = { parameters: [integer], result: wide, error: failure };
  assert.throws(() => rustCallableConversionPhysical(selected, actual, file), /explicit type definitions/u);
  assert.throws(() => rustCallableConversionPhysical(selected, actual, file, emptyRustTypeDefinitions), /selected source signature decoder/u);
  for (const [label, source] of [["arity", { ...actual, parameters: [] }], ["sparse", { ...actual, parameters: new Array(1) }],
    ["input", { ...actual, parameters: [wide] }], ["result", { ...actual, result: integer }],
    ["missing error", { ...actual, error: undefined }], ["extra", { ...actual, extra: true }]])
    assert.equal(rustCallableConversionPhysical(selected, source, file, emptyRustTypeDefinitions, rustCallablePhysicalSignature) === undefined, true, label);
  for (const changed of [null, undefined, { ...selected, extra: true }, { ...selected, result: { kind: "borrow" } },
    { ...selected, parameters: [] }]) {
    assert.equal(rustCallableConversionPhysical(changed, actual, file, emptyRustTypeDefinitions, rustCallablePhysicalSignature) === undefined, true);
    assert.equal(rustCallableConversionErrorArities(changed) === undefined, true);
  }
  assert.equal(rustCallablePhysicalSignature(selected.source) === undefined, true, "logical source cannot masquerade as physical");
  const invalid = { ...physicalCarrier(actual), value: { ...physicalCarrier(actual).value, id: "fixture:Other" } };
  assert.equal(rustCallablePhysicalSignature(invalid) === undefined, true);
});

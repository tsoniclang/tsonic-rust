import assert from "node:assert/strict";
import test from "node:test";
import {
  isRustCallableSignatureBinding, rustCallableSignatureBinding, rustCallableSignatureProtocol,
} from "../../../dist/target-model/types/carriers/callable-signatures.js";
import {
  rustFrameCallableCarrier, rustFrameCallableTargetType, rustFrameCallableValue, rustFrameCallableProtocol,
} from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { substituteRustTargetGenerics, substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeParameterIdentities } from "../../../dist/target-model/types/carriers/generic-references.js";
import { isRustCallableCarrier, rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustStructuralMethodStorageCarrier } from "../../../dist/policy/types/objects/member-storage.js";
import { rustGenericCallableTargetType, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";

const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "target-named", id: "rust.std.String" };
const parameter = identity => ({ kind: "type-parameter", identity, name: identity });
const owner = { kind: "lexical", origin: { fileName: "/factory.ts", declarationIdentity: "checked:activation:1" } };

test("callable signatures substitute only free native lifetimes and preserve their quantified type binders", () => {
  const free = { kind: "parameter", identity: "storage", name: "storage" };
  const bound = { kind: "bound", binderIdentity: "call-binder", identity: "call", name: "call" };
  const reference = lifetime => ({ kind: "reference", referent: parameter("Value"), mutable: false, lifetime });
  const nested = { kind: "function-pointer", args: [reference(bound)], result: reference(free),
    lifetimeBinder: { identity: "call-binder", parameters: [{ lifetime: bound, outlives: [] }] } };
  const selected = rustGenericCallableTargetType([parameter("Value")], [reference(free), nested], reference(free), owner.origin);
  const original = rustGenericCallableValue(selected);
  const protocolParameter = original.signature.typeParameters[0];
  const substitutions = new Map([[rustLifetimeKey(free), { kind: "static" }], [rustLifetimeKey(bound), { kind: "static" }]]);
  const result = rustGenericCallableValue(substituteRustTargetGenerics(selected,
    new Map([[protocolParameter.identity, number]]), substitutions));
  assert.equal(rustTargetTypeRefEquals(result.signature.parameters[0].referent, protocolParameter), true);
  assert.equal(result.signature.parameters[0].lifetime.kind, "static");
  assert.equal(result.signature.parameters[1].args[0].lifetime.identity, bound.identity);
  assert.equal(result.signature.parameters[1].result.lifetime.kind, "static");
  assert.equal(result.signature.result.lifetime.kind, "static");
  assert.deepEqual(result.signature.typeParameters, original.signature.typeParameters);
  assert.deepEqual(result.signature.environmentParameters, original.signature.environmentParameters);
  assert.deepEqual(result.origin, original.origin);
  assert.equal(Object.isFrozen(result.signature.parameters), true);
});

test("monomorphic structural method storage preserves its selected native environment lifetime", () => {
  for (const lifetime of [{ kind: "static" }, { kind: "parameter", identity: "environment", name: "environment" }]) {
    const callable = rustCallableTargetType([number], string, lifetime);
    const selected = rustStructuralMethodStorageCarrier(number, callable, "required");
    assert.deepEqual(rustCallableProtocol(selected).lifetime, lifetime);
    assert.deepEqual(rustCallableProtocol(selected).parameters, [number, number]);
  }
});

test("monomorphic and quantified callable storage use the same normalized signature owner", () => {
  const ordinary = rustCallableSignatureBinding([], [number], string);
  assert.deepEqual(rustCallableSignatureProtocol(ordinary, []), { parameters: [number], result: string });
  const generic = rustCallableSignatureBinding([parameter("Value")], [parameter("Value"), parameter("Owner")], parameter("Value"));
  const renamed = rustCallableSignatureBinding([parameter("Element")], [parameter("Element"), parameter("Owner")], parameter("Element"));
  assert.deepEqual(generic, renamed);
  assert.deepEqual(rustCallableSignatureProtocol(generic, [string]), { parameters: [string, parameter("Owner")], result: string });
  assert.equal(rustCallableSignatureProtocol(generic, []), undefined);
  assert.equal(rustCallableSignatureProtocol(generic, Array(1)), undefined);
});

test("frame carriers retain activation identity independently of their logical signature", () => {
  const left = rustFrameCallableTargetType([number], number, owner);
  const alias = rustFrameCallableTargetType([number], number, { ...owner });
  const other = rustFrameCallableTargetType([number], number, { ...owner, origin: { ...owner.origin, declarationIdentity: "checked:activation:2" } });
  assert.equal(rustTargetTypeRefEquals(left, alias), true);
  assert.equal(rustTargetTypeRefEquals(left, other), false);
  assert.deepEqual(rustFrameCallableProtocol(left), { parameters: [number], result: number });
  assert.equal(Object.isFrozen(left.value), true);
  assert.equal(Object.isFrozen(left.value.signature.parameters), true);
  assert.equal(isRustCallableCarrier(left), true);
  assert.deepEqual(rustCallableProtocol(left), rustFrameCallableProtocol(left));
});

test("body-only generic captures survive one exact frame environment", () => {
  const original = rustFrameCallableTargetType([number], number, owner, [parameter("Hidden")]);
  const value = rustFrameCallableValue(original);
  assert.deepEqual(value.environment, [parameter("Hidden")]);
  assert.deepEqual(rustFrameCallableProtocol(original), { parameters: [number], result: number });
  const instantiated = rustFrameCallableCarrier({ ...value, environment: [string] });
  assert.deepEqual(rustFrameCallableProtocol(instantiated), { parameters: [number], result: number });
  assert.equal(rustFrameCallableValue({ ...original, value: { ...value, environment: [] } }), undefined);
  assert.deepEqual(rustTargetTypeParameterIdentities(original), ["Hidden"]);
  const selected = substituteRustTargetTypeParameters(original, new Map([["Hidden", string]]));
  assert.deepEqual(rustFrameCallableValue(selected).environment, [string]);
  assert.deepEqual(rustTargetTypeParameterIdentities(selected), []);
});

test("signature boundaries reject missing, sparse, malformed and unbound selections", () => {
  assert.equal(rustCallableSignatureBinding([parameter("Same"), parameter("Same")], [], number), undefined);
  assert.equal(rustCallableSignatureBinding([], Array(1), number), undefined);
  assert.equal(rustCallableSignatureBinding([], [], { kind: "unknown" }), undefined);
  const valid = rustCallableSignatureBinding([], [number], number);
  assert.equal(isRustCallableSignatureBinding({ ...valid, signature: { ...valid.signature, result: parameter("Foreign") } }), false);
  assert.equal(isRustCallableSignatureBinding({ ...valid, signature: { ...valid.signature, parameters: Array(1) } }), false);
  assert.equal(isRustCallableSignatureBinding({ ...valid, extra: true }), false);
  assert.equal(rustFrameCallableTargetType([], number, { ...owner, origin: { ...owner.origin, declarationIdentity: "" } }), undefined);
});

test("signature and frame readers reject accessor metadata without executing it", () => {
  let reads = 0;
  const valid = rustFrameCallableTargetType([number], number, owner);
  const forged = { ...valid.value };
  Object.defineProperty(forged, "signature", { enumerable: true, get() { reads++; return valid.value.signature; } });
  assert.equal(rustFrameCallableValue({ ...valid, value: forged }), undefined);
  const signature = { ...valid.value.signature };
  Object.defineProperty(signature, "result", { enumerable: true, get() { reads++; return number; } });
  assert.equal(isRustCallableSignatureBinding({ signature, environment: [] }), false);
  assert.equal(reads, 0);
});

test("class frame owners preserve exact native instances and body-only generic substitutions", () => {
  const instance = rustSourceTypeCarrier(owner.origin.fileName, "Owner", "object", [
    { kind: "type", type: parameter("Element") },
  ]);
  const selected = rustFrameCallableTargetType([number], number, { kind: "class", origin: owner.origin, instance });
  assert.equal(selected !== undefined, true);
  assert.deepEqual(rustFrameCallableValue(selected).environment, [parameter("Element")]);
  assert.deepEqual(rustTargetTypeParameterIdentities(selected), ["Element"]);
  const substituted = substituteRustTargetTypeParameters(selected, new Map([["Element", string]]));
  const value = rustFrameCallableValue(substituted);
  assert.deepEqual(value.environment, [string]);
  assert.deepEqual(rustSourceTypeCarrierValue(value.owner.instance).genericArguments, [{ kind: "type", type: string }]);
  assert.deepEqual(rustFrameCallableProtocol(substituted), { parameters: [number], result: number });
  assert.equal(Object.isFrozen(selected.value.owner.instance.value.genericArguments), true);
  assert.equal(rustTargetTypeRefEquals(selected, rustFrameCallableTargetType([number], number, owner)), false);
});

test("one class-frame template substitutes owner, invocation and captured environment together", () => {
  const element = parameter("Element");
  const captured = parameter("Captured");
  const instance = rustSourceTypeCarrier(owner.origin.fileName, "Value", "object", [{ kind: "type", type: element }]);
  const template = rustFrameCallableTargetType([element], captured, { kind: "class", origin: owner.origin, instance }, [captured]);
  const original = rustFrameCallableValue(template);
  const actual = substituteRustTargetTypeParameters(template, new Map([[element.identity, string], [captured.identity, number]]));
  const value = rustFrameCallableValue(actual);
  assert.equal(value !== undefined, true, "the full existing class-frame template has one valid instantiation");
  assert.equal(value.signature.environmentParameters.length, original.signature.environmentParameters.length,
    "closing actual arguments never creates a new environment-binder shape");
  assert.equal(value.environment.length, 2, "owner and captured body generics are both retained");
  assert.equal(rustTargetTypeRefEquals(value.environment[0], string), true, "the actual receiver argument is substituted");
  assert.equal(rustTargetTypeRefEquals(value.environment[1], number), true, "the actual independent capture is substituted");
  const protocol = rustFrameCallableProtocol(actual);
  assert.equal(rustTargetTypeRefEquals(protocol.parameters[0], string), true, "the invocation input uses the same actual receiver binding");
  assert.equal(rustTargetTypeRefEquals(protocol.result, number), true, "the result uses the same actual captured binding");
  const wrong = substituteRustTargetTypeParameters(template, new Map([[element.identity, number], [captured.identity, string]]));
  assert.equal(rustTargetTypeRefEquals(actual, wrong), false, "equal arity cannot exchange receiver and captured identities");
  assert.equal(rustTargetTypeRefEquals(template, actual), false, "the unbound template cannot masquerade as a concrete native frame");
});

test("class frame owners reject malformed, foreign and obsolete identity metadata without getter execution", () => {
  const instance = rustSourceTypeCarrier(owner.origin.fileName, "Owner", "object");
  const valid = { kind: "class", origin: owner.origin, instance };
  for (const rejected of [owner.origin, { ...valid, instance: number },
    { ...valid, instance: rustSourceTypeCarrier("/foreign.ts", "Owner", "object") },
    { ...valid, instance: rustSourceTypeCarrier(owner.origin.fileName, "Enum", "enum") },
    { ...valid, origin: { ...owner.origin, declarationIdentity: "" } },
    { ...valid, extra: true }]) {
    assert.equal(rustFrameCallableTargetType([], number, rejected) === undefined, true);
  }
  let reads = 0;
  for (const property of ["kind", "origin", "instance"]) {
    const accessor = { ...valid };
    Object.defineProperty(accessor, property, { enumerable: true, get() { reads++; return valid[property]; } });
    assert.equal(rustFrameCallableTargetType([], number, accessor) === undefined, true, property);
  }
  assert.equal(reads, 0);
});

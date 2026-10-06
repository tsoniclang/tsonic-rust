import assert from "node:assert/strict";
import test from "node:test";
import {
  isRustCallableSignatureBinding, rustCallableSignatureBinding, rustCallableSignatureProtocol,
} from "../../../dist/target-model/types/carriers/callable-signatures.js";
import {
  rustFrameCallableCarrier, rustFrameCallableTargetType, rustFrameCallableValue, rustFrameCallableProtocol,
} from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeParameterIdentities } from "../../../dist/target-model/types/carriers/generic-references.js";
import { isRustCallableCarrier, rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";

const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "target-named", id: "rust.std.String" };
const parameter = identity => ({ kind: "type-parameter", identity, name: identity });
const owner = { fileName: "/factory.ts", declarationIdentity: "checked:activation:1" };

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
  const other = rustFrameCallableTargetType([number], number, { ...owner, declarationIdentity: "checked:activation:2" });
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
  assert.equal(rustFrameCallableTargetType([], number, { ...owner, declarationIdentity: "" }), undefined);
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

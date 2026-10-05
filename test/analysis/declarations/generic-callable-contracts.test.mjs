import assert from "node:assert/strict";
import test from "node:test";
import { rustGenericCallableTargetType, rustGenericCallableValue, rustGenericCallableProtocol } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeParameterIdentities } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustFutureTargetType } from "../../../dist/target-model/types/carriers/primitives.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/carriers/optional.js";
import { rustStructuralMethodCallableCarrier, rustStructuralMethodStorageCarrier } from "../../../dist/target-model/types/carriers/callables.js";

const parameter = name => ({ kind: "type-parameter", identity: name, name });
const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "target-named", id: "rust.std.String" };
const origin = { fileName: "/factory.ts", declarationIdentity: "/factory.ts\u000010\u000020\u000050" };

test("generic structural storage retains exact call binders, receivers and selected type arguments", () => {
  const callable = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), origin);
  assert.equal(rustStructuralMethodCallableCarrier(callable, "required"), callable);
  const stored = rustStructuralMethodStorageCarrier(parameter("Owner"), callable, "required");
  assert.deepEqual(rustGenericCallableValue(stored).environment, [parameter("Owner")]);
  assert.deepEqual(rustGenericCallableValue(stored).origin, origin);
  assert.deepEqual(rustGenericCallableProtocol(stored, [number]), { parameters: [parameter("Owner"), number], result: number });
  const optional = rustStructuralMethodStorageCarrier(parameter("Owner"), rustOptionTargetType(callable), "optional");
  assert.deepEqual(optional, rustOptionTargetType(stored));
  assert.equal(rustGenericCallableProtocol(stored, []), undefined);
  assert.equal(rustGenericCallableProtocol(stored, [{ kind: "unknown" }]), undefined);
  assert.equal(rustGenericCallableProtocol(stored, Array(1)), undefined);
});

test("closed opaque-future callables retain zero binders and exact environments", () => {
  for (const result of [rustFutureTargetType(parameter("Owner")), rustOptionTargetType(rustFutureTargetType(parameter("Owner")))]) {
    const carrier = rustGenericCallableTargetType([], [parameter("Owner")], result, origin);
    assert.deepEqual(rustGenericCallableValue(carrier).signature.typeParameters, []);
    assert.deepEqual(rustGenericCallableValue(carrier).environment, [parameter("Owner")]);
    const concrete = substituteRustTargetTypeParameters(carrier, new Map([["Owner", number]]));
    assert.deepEqual(rustGenericCallableProtocol(concrete, []), {
      parameters: [number], result: substituteRustTargetTypeParameters(result, new Map([["Owner", number]])),
    });
    assert.equal(rustGenericCallableProtocol(concrete, [parameter("Extra")]), undefined);
  }
  assert.equal(rustGenericCallableTargetType([], [], number, origin), undefined);
  const valid = rustGenericCallableTargetType([], [], rustFutureTargetType(number), origin);
  assert.equal(rustGenericCallableValue({ ...valid, value: { ...valid.value,
    signature: { ...valid.value.signature, result: number },
  } }), undefined);
});

test("quantified callables retain alpha equivalence without leaking call binders", () => {
  const first = rustGenericCallableTargetType([parameter("Value")], [parameter("Value"), parameter("Owner")], parameter("Value"), origin);
  const second = rustGenericCallableTargetType([parameter("Element")], [parameter("Element"), parameter("Owner")], parameter("Element"), origin);
  assert.equal(rustTargetTypeRefEquals(first, second), true);
  assert.deepEqual(rustTargetTypeParameterIdentities(first), ["Owner"]);
  const concrete = substituteRustTargetTypeParameters(first, new Map([["Owner", number], ["generic-callable:Call:0", string]]));
  assert.deepEqual(rustTargetTypeParameterIdentities(concrete), []);
  assert.deepEqual(rustGenericCallableValue(concrete).origin, origin);
  assert.deepEqual(rustGenericCallableProtocol(concrete, [parameter("Item")]), {
    parameters: [parameter("Item"), number], result: parameter("Item"),
  });
});

test("body-only captures retain their free native generic environment without entering the call signature", () => {
  const callable = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), origin,
    [{ kind: "array", element: parameter("Owner") }, parameter("Owner"), parameter("Value"), number]);
  assert.deepEqual(rustGenericCallableValue(callable).environment, [parameter("Owner")]);
  assert.deepEqual(rustTargetTypeParameterIdentities(callable), ["Owner"]);
  assert.deepEqual(rustGenericCallableProtocol(callable, [string]), { parameters: [string], result: string });
  const concrete = substituteRustTargetTypeParameters(callable, new Map([["Owner", number]]));
  assert.deepEqual(rustGenericCallableValue(concrete).environment, [number]);
  assert.deepEqual(rustGenericCallableProtocol(concrete, [string]), { parameters: [string], result: string });
  assert.equal(Object.isFrozen(callable.value.environment), true);
});

test("a structural receiver rebuild preserves body-only generic dependencies", () => {
  const callable = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), origin,
    [parameter("Hidden")]);
  const stored = rustStructuralMethodStorageCarrier(parameter("Receiver"), callable, "required");
  assert.deepEqual(rustGenericCallableValue(stored).environment, [parameter("Receiver"), parameter("Hidden")]);
  assert.deepEqual(rustGenericCallableProtocol(stored, [string]), {
    parameters: [parameter("Receiver"), string], result: string,
  });
});

test("nested quantified signatures substitute outer environments without capturing an inner call binder", () => {
  const outer = { ...parameter("Same"), identity: "outer:Same" };
  const inner = { ...parameter("Same"), identity: "inner:Same" };
  const returned = rustGenericCallableTargetType([inner], [inner], inner, origin, [outer]);
  const factory = rustGenericCallableTargetType([outer], [outer], returned, {
    ...origin, declarationIdentity: "factory",
  });
  assert.deepEqual(rustTargetTypeParameterIdentities(factory), []);
  const first = rustGenericCallableProtocol(factory, [number]).result;
  const second = rustGenericCallableProtocol(factory, [string]).result;
  assert.deepEqual(rustGenericCallableValue(first).environment, [number]);
  assert.deepEqual(rustGenericCallableValue(second).environment, [string]);
  assert.deepEqual(rustGenericCallableProtocol(first, [string]), { parameters: [string], result: string });
  assert.deepEqual(rustGenericCallableProtocol(second, [number]), { parameters: [number], result: number });
  assert.equal(rustTargetTypeRefEquals(first, second), false);
});

test("body-only environment inputs reject malformed and accessor-backed carrier arrays", () => {
  let reads = 0;
  const accessor = [];
  Object.defineProperty(accessor, "0", { enumerable: true, get() { reads++; return parameter("Owner"); } });
  for (const inputs of [Array(1), [undefined], [{ kind: "unknown" }], accessor]) {
    assert.equal(rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), origin, inputs) === undefined, true);
  }
  assert.equal(reads, 0);
});

test("quantified callable contract rejects malformed binders and missing environments", () => {
  assert.equal(rustGenericCallableTargetType(["Value"], [], number, origin), undefined);
  assert.equal(rustGenericCallableTargetType([{ kind: "type-parameter", name: "Value" }], [], number, origin), undefined);
  const carrier = rustGenericCallableTargetType([parameter("Value")], [parameter("Value"), parameter("Owner")], parameter("Value"), origin);
  assert.equal(rustGenericCallableTargetType([parameter("Value"), parameter("Value")], [], number, origin), undefined);
  assert.equal(rustGenericCallableProtocol(carrier, []), undefined);
  const value = rustGenericCallableValue(carrier);
  for (const changed of [
    { ...value, environment: [] },
    { ...value, extra: true },
    { ...value, origin: undefined },
    { ...value, origin: { ...origin, declarationIdentity: "" } },
    { ...value, origin: { ...origin, fileName: "" } },
    { ...value, origin: { ...origin, extra: true } },
    { ...value, signature: { ...value.signature, typeParameters: ["Wrong"] } },
    { ...value, signature: { ...value.signature, result: parameter("Unbound") } },
  ]) assert.equal(rustGenericCallableValue({ ...carrier, value: changed }), undefined);
});

test("equal generic signatures retain distinct immutable selected declaration origins", () => {
  const source = { ...origin };
  const first = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), source);
  const second = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), {
    fileName: "/other.ts", declarationIdentity: "/other.ts\u000010\u000020\u000050",
  });
  assert.deepEqual(rustGenericCallableValue(first).signature, rustGenericCallableValue(second).signature);
  assert.equal(rustTargetTypeRefEquals(first, second), false);
  source.declarationIdentity = "changed";
  assert.deepEqual(rustGenericCallableValue(first).origin, origin);
  assert.ok(Object.isFrozen(first.value.origin));
  let reads = 0;
  const malformed = { get fileName() { reads++; return "/factory.ts"; }, declarationIdentity: origin.declarationIdentity };
  assert.equal(rustGenericCallableValue({ ...first, value: { ...first.value, origin: malformed } }), undefined);
  assert.equal(reads, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { rustGenericCallableTargetType, rustGenericCallableValue, rustGenericCallableProtocol } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeParameterIdentities } from "../../../dist/target-model/types/carriers/generic-references.js";

const parameter = name => ({ kind: "type-parameter", identity: name, name });
const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "target-named", id: "rust.std.String" };
const origin = { fileName: "/factory.ts", declarationIdentity: "/factory.ts\u000010\u000020\u000050" };

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

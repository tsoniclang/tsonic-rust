import assert from "node:assert/strict";
import test from "node:test";
import { rustGenericCallableTargetType, rustGenericCallableValue, rustGenericCallableProtocol } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeParameterNames } from "../../../dist/target-model/types/carriers/generic-references.js";

const parameter = name => ({ kind: "type-parameter", name });
const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "target-named", id: "rust.std.String" };

test("quantified callables retain alpha equivalence without leaking call binders", () => {
  const first = rustGenericCallableTargetType(["Value"], [parameter("Value"), parameter("Owner")], parameter("Value"));
  const second = rustGenericCallableTargetType(["Element"], [parameter("Element"), parameter("Owner")], parameter("Element"));
  assert.equal(rustTargetTypeRefEquals(first, second), true);
  assert.deepEqual(rustTargetTypeParameterNames(first), ["Owner"]);
  const concrete = substituteRustTargetTypeParameters(first, new Map([["Owner", number], ["CallType0", string]]));
  assert.deepEqual(rustTargetTypeParameterNames(concrete), []);
  assert.deepEqual(rustGenericCallableProtocol(concrete, ["Item"]), {
    parameters: [parameter("Item"), number], result: parameter("Item"),
  });
});

test("quantified callable contract rejects malformed binders and missing environments", () => {
  const carrier = rustGenericCallableTargetType(["Value"], [parameter("Value"), parameter("Owner")], parameter("Value"));
  assert.equal(rustGenericCallableTargetType(["Value", "Value"], [], number), undefined);
  assert.equal(rustGenericCallableProtocol(carrier, []), undefined);
  const value = rustGenericCallableValue(carrier);
  for (const changed of [
    { ...value, environment: [] },
    { ...value, extra: true },
    { ...value, signature: { ...value.signature, typeParameters: ["Wrong"] } },
    { ...value, signature: { ...value.signature, result: parameter("Unbound") } },
  ]) assert.equal(rustGenericCallableValue({ ...carrier, value: changed }), undefined);
});

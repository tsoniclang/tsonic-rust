import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableProtocol, rustCallableTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { rustTupleTargetType } from "../../dist/target-model/types/carriers/native.js";

const number = { kind: "source-primitive", name: "float64" };
const boolean = { kind: "source-primitive", name: "bool" };

test("callable ABI parameters always retain their native tuple even for homogeneous arguments", () => {
  for (const parameters of [[], [number], [number, number], [number, boolean, number]]) {
    const carrier = rustCallableTargetType(parameters, boolean);
    assert.deepEqual(rustCallableProtocol(carrier), { parameters, result: boolean });
    assert.equal(carrier.genericArguments[0].type.kind, "tuple");
  }
  assert.equal(rustTupleTargetType([number, number]).name, "fixed-array");
});

test("callable ABI rejects a data array in the parameter tuple slot", () => {
  const carrier = rustCallableTargetType([number, number], boolean);
  const malformed = { ...carrier, genericArguments: [
    { kind: "type", type: rustTupleTargetType([number, number]) }, carrier.genericArguments[1],
  ] };
  assert.equal(rustCallableProtocol(malformed), undefined);
});

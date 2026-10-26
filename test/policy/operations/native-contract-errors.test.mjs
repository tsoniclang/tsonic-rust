import assert from "node:assert/strict";
import test from "node:test";
import { rustOperationAbiConversionsAreFallible, rustOperationAbiInvocationIsFallible,
  rustOperationAbiAwaitIsFallible } from "../../../dist/policy/operations/members/native-contracts.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("native ABI invocation and receiver input output conversion effects remain independent", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  const byte = rustSourcePrimitiveTargetType("uint8");
  const identity = { kind: "identity", sourceCarrier: integer, targetCarrier: integer, fallible: false };
  const conversion = { kind: "semantic", sourceCarrier: integer, targetCarrier: byte,
    conversion: { kind: "checked-i32-to-u8" }, fallible: true };
  const input = { source: { kind: "argument", sourceIndex: 0 }, sourceCarrier: integer, conversion,
    mode: "value", parameterCarrier: byte, sharedConversion: false, elementView: "value" };
  const pure = { operationKind: "call", target: { form: "call", path: "fixture::invoke" },
    sourceReceiver: { kind: "none" }, sourceArguments: [], targetReceiver: { kind: "none" },
    targetArguments: [], dispatchInputs: [], targetGenericArguments: [],
    result: { kind: "sync", rawCarrier: integer, carrier: integer, conversion: identity },
    effects: { evaluation: "observable", invocation: "infallible", awaiting: "not-applicable",
      errorBoundary: "source-package", safety: "safe" } };
  const controls = [
    ["pure", pure, false],
    ["receiver", { ...pure, targetReceiver: { kind: "input", input: { ...input, source: { kind: "receiver" } } } }, true],
    ["argument", { ...pure, targetArguments: [input] }, true],
    ["slice", { ...pure, targetArguments: [{ source: { kind: "argument-slice", sourceIndexes: [0] },
      elements: [input], elementCarrier: byte, mode: "ref", parameterCarrier: byte }] }, true],
    ["array", { ...pure, targetArguments: [{ source: { kind: "argument-array", sourceIndexes: [0] },
      elements: [input], elementCarrier: byte, mode: "value" }] }, true],
    ["tagged array", { ...pure, targetArguments: [{ source: { kind: "argument-tagged-array", sourceIndexes: [0] },
      elements: [{ input, constructorPath: "fixture::Value" }], elementCarrier: integer, mode: "value" }] }, true],
    ["result", { ...pure, result: { ...pure.result, carrier: byte, conversion } }, true],
  ];
  for (const [name, abi, expected] of controls) {
    for (const invocation of ["fallible", "infallible"]) {
      const selected = { ...abi, effects: { ...abi.effects, invocation } };
      assert.equal(rustOperationAbiConversionsAreFallible(selected), expected, `${name}/${invocation}: conversion effect is independent`);
      assert.equal(rustOperationAbiInvocationIsFallible(selected), expected || invocation === "fallible",
        `${name}/${invocation}: invocation keeps either existing fallible boundary`);
    }
  }
  const asynchronous = { ...pure, result: { kind: "async", futureCarrier: integer,
    awaitedRawCarrier: integer, awaitedCarrier: byte, awaitedConversion: conversion } };
  assert.equal(rustOperationAbiConversionsAreFallible(asynchronous), false, "awaited conversion is not charged to synchronous invocation");
  assert.equal(rustOperationAbiAwaitIsFallible(asynchronous), true, "awaited conversion retains its own execution phase");
});

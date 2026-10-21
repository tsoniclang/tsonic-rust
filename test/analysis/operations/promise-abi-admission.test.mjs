import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustProviderOperationAbi } from "../../../dist/policy/operations/members/abi/finalize.js";
import { validateRustFinalizedOperationAbi } from "../../../dist/policy/operations/members/abi/validation.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustJsPromiseTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

const payload = rustSourcePrimitiveTargetType("uint64");
const options = () => ({
  operationKind: "method",
  form: { form: "call", path: "js_abi::pending" },
  sourceArgumentCarriers: [],
  resultCarrier: rustJsPromiseTargetType(payload),
  isAsync: false,
  isFallible: false,
  returnedFuture: { awaiting: "fallible", errorBoundary: "js-rejection" },
});

test("Promise rejection protocol survives actual operation finalization and validation", () => {
  const abi = finalizeRustProviderOperationAbi(options());
  assert.equal(abi !== undefined, true, "a returned Promise admits its JS rejection protocol");
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  assert.equal(abi.effects.invocation, "infallible");
  assert.equal(abi.effects.awaiting, "fallible");
  assert.equal(abi.effects.errorBoundary, "js-rejection");
  assert.equal(Object.hasOwn(abi.effects, "errorCarrier"), false);
  assert.equal(abi.result.carrier.genericArguments.length, 1);
  assert.equal(rustTargetTypeRefEquals(abi.result.carrier.genericArguments[0].type, payload), true);
});

test("awaited JS rejection never broadens synchronous native invocation errors", () => {
  const native = { ...options(), resultCarrier: payload, returnedFuture: undefined, isFallible: true };
  assert.equal(finalizeRustProviderOperationAbi({ ...native, errorBoundary: "js-rejection" }) === undefined, true);
  for (const errorBoundary of ["target-runtime", "source-program"]) {
    const abi = finalizeRustProviderOperationAbi({ ...native, errorBoundary });
    assert.equal(abi !== undefined, true, errorBoundary);
    assert.equal(validateRustFinalizedOperationAbi(abi), true, errorBoundary);
  }
  const abi = finalizeRustProviderOperationAbi(options());
  assert.equal(abi !== undefined, true);
  for (const effects of [
    { ...abi.effects, awaiting: "not-applicable", invocation: "fallible" },
    { ...abi.effects, invocation: "fallible" },
    { ...abi.effects, awaiting: "infallible" },
    { ...abi.effects, errorCarrier: rustJsValueTargetType() },
    { ...abi.effects, nativeErrorCarriers: [] },
  ]) assert.equal(validateRustFinalizedOperationAbi({ ...abi, effects }), false);
});

test("Promise finalization rejects contradictory rejection-carrier and awaiting metadata", () => {
  const base = options();
  for (const returnedFuture of [
    { ...base.returnedFuture, errorCarrier: rustJsValueTargetType() },
    { ...base.returnedFuture, awaiting: "infallible" },
    { ...base.returnedFuture, errorBoundary: "invented" },
  ]) assert.equal(finalizeRustProviderOperationAbi({ ...base, returnedFuture }) === undefined, true);
});

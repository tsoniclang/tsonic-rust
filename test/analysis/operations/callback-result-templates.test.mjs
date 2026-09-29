import test from "node:test";
import assert from "node:assert/strict";
import { finalizeRustCallbackOperation } from "../../../dist/analysis/operations/provider/callbacks.js";
import {
  rustCallableTargetType, rustJsArrayTargetType, rustJsPromiseTargetTypeWithLifetime,
  rustOptionTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType,
} from "../../../dist/target-model/types/index.js";
import { rustStaticLifetime } from "../../../dist/target-model/lifetimes/index.js";

const inferred = { kind: "opaque", id: "tsonic.rust.infer" };
const integer = rustSourcePrimitiveTargetType("uint64");
const number = rustSourcePrimitiveTargetType("float64");
const promise = output => rustJsPromiseTargetTypeWithLifetime(output, rustStaticLifetime);

function selection(result, parameters, projection) {
  return {
    callback: { shape: "map", sourceArgumentIndex: 0, failure: { kind: "returned-future" },
      ...(projection === undefined ? {} : { resultProjection: projection }) },
    parameterCarriers: parameters,
    fact: { kind: "provider-operation", operationId: "proof.native.callback", operationKind: "method",
      resultCarrier: result, parameterCarriers: parameters, isAsync: false, isFallible: false, errorBoundary: "none",
      target: { form: "receiver-method", name: "selected" } },
  };
}

test("deferred callback result substitution shares one owner for native array and Promise carriers", () => {
  const callback = rustCallableTargetType([integer], integer);
  for (const container of [rustJsArrayTargetType, promise]) {
    const selected = finalizeRustCallbackOperation(selection(container(inferred), [rustCallableTargetType([integer], inferred)]), [callback]);
    assert.deepEqual(selected.resultCarrier, container(integer));
    assert.deepEqual(selected.parameterCarriers, [callback]);
  }
});

test("awaited callback results project the exact payload without replacing the error owner", () => {
  const callback = rustCallableTargetType([integer], promise(integer));
  const selected = finalizeRustCallbackOperation(selection(promise(inferred), [rustCallableTargetType([integer], inferred)], "awaited"), [callback]);
  assert.deepEqual(selected.resultCarrier, promise(integer));
  assert.deepEqual(selected.parameterCarriers, [callback]);
  assert.equal(finalizeRustCallbackOperation(selection(promise(inferred), [rustCallableTargetType([integer], inferred)], "awaited"),
    [rustCallableTargetType([integer], integer)]), undefined);
});

test("later optional handler signatures receive the inferred result and reject conflicting carriers", () => {
  const selected = selection(promise(inferred), [rustCallableTargetType([integer], inferred),
    rustOptionTargetType(rustCallableTargetType([rustProgramErrorTargetType()], inferred))]);
  const callback = rustCallableTargetType([integer], integer);
  const rejection = rustOptionTargetType(rustCallableTargetType([rustProgramErrorTargetType()], integer));
  assert.deepEqual(finalizeRustCallbackOperation(selected, [callback]).parameterCarriers, [callback, rejection]);
  assert.deepEqual(finalizeRustCallbackOperation(selected, [callback, rejection]).parameterCarriers, [callback, rejection]);
  assert.equal(finalizeRustCallbackOperation(selected, [callback,
    rustOptionTargetType(rustCallableTargetType([rustProgramErrorTargetType()], number))]), undefined);
  assert.equal(finalizeRustCallbackOperation(selected, [rustCallableTargetType([number], integer)]), undefined);
});

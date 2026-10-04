import test from "node:test";
import assert from "node:assert/strict";
import { finalizeRustCallbackOperation } from "../../../dist/analysis/operations/provider/callbacks.js";
import {
  rustCallableTargetType, rustJsArrayTargetType, rustJsPromiseTargetTypeWithLifetime,
  rustJsValueTargetType, rustOptionTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType,
  rustUnitTargetType,
} from "../../../dist/target-model/types/index.js";
import { rustStaticLifetime } from "../../../dist/target-model/lifetimes/index.js";
import { selectRustCallableConversion } from "../../../dist/target-model/conversions/callable.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";

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

test("deferred callback conversion preserves the selected native ABI rather than the authored carrier", () => {
  const native = rustCallableTargetType([integer], rustUnitTargetType());
  const authored = rustCallableTargetType([rustJsValueTargetType()], rustUnitTargetType());
  const accepts = (source, target) => selectRustCallableConversion(source, target,
    (input, output) => selectRustSourceValueConversion(input, output)) !== undefined;
  const selected = finalizeRustCallbackOperation(selection(promise(inferred), [
    rustCallableTargetType([integer], inferred),
  ]), [authored], accepts);
  assert.deepEqual(selected.parameterCarriers, [native]);
  assert.deepEqual(selected.fact.parameterCarriers, [native]);
  assert.deepEqual(selected.resultCarrier, promise(rustUnitTargetType()));
  assert.equal(finalizeRustCallbackOperation(selection(promise(inferred), [native]), [authored]), undefined);
  assert.equal(finalizeRustCallbackOperation(selection(promise(inferred), [native]), [
    rustCallableTargetType([rustSourcePrimitiveTargetType("bool")], rustUnitTargetType()),
  ], accepts), undefined);
  const discarded = finalizeRustCallbackOperation(selection(promise(inferred), [native]), [
    rustCallableTargetType([rustJsValueTargetType()], number),
  ], accepts);
  assert.deepEqual(discarded.parameterCarriers, [native]);
  assert.deepEqual(discarded.resultCarrier, promise(rustUnitTargetType()));
});

test("direct callback conversions retain every selected parameter and reject unmatched result shape", () => {
  const native = rustCallableTargetType([integer], integer);
  const authored = rustCallableTargetType([rustJsValueTargetType()], integer);
  const input = { ...selection(promise(integer), [native]),
    callback: { shape: "direct", sourceArgumentIndex: 0, failure: { kind: "returned-future" } } };
  const accepts = (source, target) => selectRustCallableConversion(source, target,
    (input, output) => selectRustSourceValueConversion(input, output)) !== undefined;
  const selected = finalizeRustCallbackOperation(input, [authored], accepts);
  assert.deepEqual(selected.parameterCarriers, [native]);
  assert.deepEqual(selected.fact.parameterCarriers, [native]);
  assert.equal(finalizeRustCallbackOperation(input, [rustCallableTargetType([integer], rustUnitTargetType())], accepts), undefined);
  assert.equal(finalizeRustCallbackOperation(input, [], accepts), undefined);
});

test("native closure finalization preserves physical callable effects for direct, map and reduce", () => {
  const accepts = (source, target) => selectRustCallableConversion(source, target,
    (input, output) => selectRustSourceValueConversion(input, output)) !== undefined;
  const closure = result => ({ kind: "closure", args: [integer], result, callTrait: "FnMut" });
  const actual = rustCallableTargetType([integer], integer);
  for (const shape of ["direct", "map", "reduce"]) {
    const parameters = shape === "reduce" ? [closure(integer), integer] : [closure(shape === "map" ? inferred : integer)];
    const input = { ...selection(shape === "map" ? rustJsArrayTargetType(inferred) : integer, parameters),
      resultCarrier: shape === "map" ? rustJsArrayTargetType(inferred) : integer,
      callback: { shape, sourceArgumentIndex: 0,
        ...(shape === "reduce" ? { accumulatorArgumentIndex: 1 } : {}),
        failure: { kind: "invocation", fallibleTarget: { form: "receiver-method", name: "try_selected" } } } };
    const arguments_ = shape === "reduce" ? [actual, integer] : [actual];
    const selected = finalizeRustCallbackOperation(input, arguments_, accepts);
    assert.equal(selected !== undefined, true, shape);
    const expected = { ...closure(integer), fallible: true };
    assert.deepEqual(selected.parameterCarriers[0], expected);
    assert.deepEqual(selected.fact.parameterCarriers, selected.parameterCarriers);
    assert.deepEqual(selected.resultCarrier, shape === "map" ? rustJsArrayTargetType(integer) : integer);
    assert.equal(finalizeRustCallbackOperation(input, arguments_) === undefined, true,
      "different callback representations require an exact conversion");
    assert.equal(finalizeRustCallbackOperation(input, [
      rustCallableTargetType([rustSourcePrimitiveTargetType("string")], integer), ...arguments_.slice(1),
    ], accepts) === undefined, true, "incompatible native inputs remain rejected");
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { finalizeRustCallbackOperation } from "../../../dist/policy/operations/members/callbacks.js";
import {
  rustCallableTargetType, rustJsArrayTargetType, rustJsErrorTargetType, rustJsPromiseTargetType,
  rustJsValueTargetType, rustOptionTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType,
  rustStringTargetType, rustUnitTargetType,
} from "../../../dist/target-model/types/index.js";
import { selectRustCallableConversion } from "../../../dist/policy/conversions/callable.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { callbackFallibleTemplate } from "../../../dist/policy/operations/members/deferred-callbacks.js";
import { rustPreparedCallbackResultEffects } from "../../../dist/analysis/errors/callback-effects.js";
import { rustRuntimeErrorTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/selection.js";
import { finalizeRustRegExpReplacementCallbackContract } from "../../../dist/policy/operations/members/regexp-callbacks.js";

const inferred = { kind: "opaque", id: "tsonic.rust.infer" };
const integer = rustSourcePrimitiveTargetType("uint64");
const number = rustSourcePrimitiveTargetType("float64");
const promise = output => rustJsPromiseTargetType(output);

test("RegExp argument projection retains the admitted callable carrier and validates every checked native slot", () => {
  const string = rustStringTargetType();
  const value = rustJsValueTargetType();
  const evidence = { lane: "native", sourceCarrier: { kind: "closure", args: [string, value], result: string },
    projections: ["native-string", "value"] };
  const sources = [evidence.sourceCarrier, { ...evidence.sourceCarrier, fallible: true },
    rustCallableTargetType([string, value], string, { kind: "static" })];
  for (const source of sources) {
    const selected = finalizeRustRegExpReplacementCallbackContract(evidence, source);
    assert.equal(selected !== undefined, true, "the checked parameter/result geometry has an admitted projection");
    assert.equal(selected.sourceCarrier === source, true, "the actual source carrier, effects and lifetime are not replaced by a synthetic closure");
    assert.equal(selected.projections === evidence.projections, true, "every checked argument projection is retained");
  }
  for (const source of [number, { ...evidence.sourceCarrier, args: [string] },
    { ...evidence.sourceCarrier, args: [value, value] }, { ...evidence.sourceCarrier, result: number }]) {
    assert.equal(finalizeRustRegExpReplacementCallbackContract(evidence, source) === undefined, true,
      "missing, mismatching or noncallable source evidence cannot supply the projection");
  }
});

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
    rustOptionTargetType(rustCallableTargetType([rustJsValueTargetType()], inferred))]);
  const callback = rustCallableTargetType([integer], integer);
  const rejection = rustOptionTargetType(rustCallableTargetType([rustJsValueTargetType()], integer));
  assert.deepEqual(finalizeRustCallbackOperation(selected, [callback]).parameterCarriers, [callback, rejection]);
  assert.deepEqual(finalizeRustCallbackOperation(selected, [callback, rejection]).parameterCarriers, [callback, rejection]);
  assert.equal(finalizeRustCallbackOperation(selected, [callback,
    rustOptionTargetType(rustCallableTargetType([rustJsValueTargetType()], number))]), undefined);
  assert.equal(finalizeRustCallbackOperation(selected, [callback,
    rustOptionTargetType(rustCallableTargetType([rustProgramErrorTargetType()], integer))]), undefined,
  "a rejected handler receives the JsValue reason, not the program error");
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
        failure: { kind: "invocation", resultError: { kind: "callback" }, fallibleTarget: { form: "receiver-method", name: "try_selected" } } } };
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

test("native callback collection reads retain Clone metadata before physical input reification", () => {
  const callback = rustCallableTargetType([number], integer);
  for (const ownerName of ["Array", "ReadonlyArray"]) {
    const request = { ownerName, memberName: "index", operationKind: "indexer",
      receiverCarrier: rustJsArrayTargetType(callback), argumentCarriers: [number] };
    const selected = selectJsSurfaceOperation(request);
    assert.equal(selected !== undefined, true, ownerName);
    assert.deepEqual(selected.fact.carrierRequirements, [{ carrier: callback, requirement: "clone",
      source: { kind: "receiver", projection: [0] } }],
      "logical runtime Callable Clone does not prove a reified physical input's Clone bound");
    const length = selectJsSurfaceOperation({ ...request, memberName: "length", operationKind: "property", argumentCarriers: [] });
    assert.equal(length.fact.carrierRequirements, undefined, "a pure length read does not require copying an element");
  }
});

test("native callback Result contracts distinguish generic invocation errors from fixed provider errors", () => {
  const callbackError = rustJsValueTargetType();
  const nativeError = rustRuntimeErrorTargetType();
  const invocationEffects = { localErrors: false, nativeErrors: [{ identity: "js-rejection", errorType: callbackError }] };
  const invocationOwner = {};
  const effects = { invocationOwner, invocationEffects, implementationEffects: invocationEffects };
  const template = selection(integer, []).fact;
  for (const resultError of [{ kind: "callback" }, { kind: "native", carrier: nativeError }]) {
    const prepared = { template, resultCarrier: integer, parameterCarriers: [],
      callback: { shape: "direct", sourceArgumentIndex: 0,
        failure: { kind: "invocation", resultError, fallibleTarget: { form: "receiver-method", name: "try_selected" } } } };
    const selected = callbackFallibleTemplate(prepared, effects);
    assert.equal(selected.isFallible, true);
    assert.equal(selected.target.name, "try_selected");
    assert.equal(selected.errorBoundary, resultError.kind === "native" ? "provider-native" : "source-program");
    assert.equal(selected.errorCarrier === nativeError, resultError.kind === "native");
    const result = rustPreparedCallbackResultEffects(prepared, invocationEffects);
    assert.equal(result.localErrors, false);
    assert.equal(result.nativeErrors.length, 1);
    assert.deepEqual(result.nativeErrors[0].errorType, resultError.kind === "native" ? nativeError : callbackError);
    assert.equal(invocationEffects.nativeErrors[0].errorType === callbackError, true, "provider selection does not rewrite the original invocation channel");
    const pure = { localErrors: false, nativeErrors: [] };
    assert.equal(callbackFallibleTemplate(prepared, { ...effects, invocationEffects: pure }) === template, true);
    const intrinsic = { ...prepared, template: { ...template, isFallible: true,
      errorBoundary: "provider-native", errorCarrier: rustJsErrorTargetType() } };
    const intrinsicEffects = rustPreparedCallbackResultEffects(intrinsic, pure);
    assert.equal(intrinsicEffects.localErrors, false);
    assert.equal(intrinsicEffects.nativeErrors.length, 1);
    assert.deepEqual(intrinsicEffects.nativeErrors[0].errorType, rustJsErrorTargetType());
    assert.equal(callbackFallibleTemplate(intrinsic, { ...effects, invocationEffects: pure }) === intrinsic.template, true,
      "the pure helper retains its original target and exact native error contract, independently of the try callback contract");
    if (resultError.kind === "callback") {
      const combined = rustPreparedCallbackResultEffects(intrinsic, invocationEffects);
      assert.equal(combined === invocationEffects, true,
        "the native helper's Result<T,E> carries callback E and converts intrinsic errors through its native From contract");
      const local = rustPreparedCallbackResultEffects(intrinsic, { localErrors: true, nativeErrors: [] });
      assert.equal(local.localErrors, true, "source throws retain their own local error owner");
      assert.deepEqual(local.nativeErrors, [], "the actual selected Result<T,TsonicError> does not invent a second JsError arm");
      assert.equal(rustPreparedCallbackResultEffects({ ...intrinsic,
        template: { ...intrinsic.template, errorCarrier: undefined } }, invocationEffects) === undefined,
      true, "a missing intrinsic native carrier cannot become a guessed local error");
    }
  }
});

test("pure intrinsic callback helpers publish their actual selected native Result error", () => {
  const callback = { kind: "closure", args: [rustStringTargetType(), rustJsValueTargetType()],
    result: rustJsValueTargetType(), callTrait: "FnMut" };
  const selected = selectJsSurfaceOperation({ ownerName: "JSON", memberName: "stringify", operationKind: "call",
    argumentCarriers: [rustJsValueTargetType(), callback] });
  assert.equal(selected !== undefined, true, "the selected JSON helper retains its checked callback contract");
  assert.equal(selected.fact.isFallible, true);
  assert.equal(selected.fact.errorBoundary, "target-runtime",
    "the canonical native boundary selects JSON's actual TsonicResult, independently of callback fallibility");
  assert.equal(selected.fact.errorCarrier, undefined, "a target-runtime boundary has no second provider-native carrier");
  assert.deepEqual(selected.callback.failure.resultError, { kind: "native", carrier: rustRuntimeErrorTargetType() });
  const prepared = { template: selected.fact, callback: selected.callback };
  const effects = { invocationEffects: { localErrors: false, nativeErrors: [] } };
  assert.equal(callbackFallibleTemplate(prepared, effects) === selected.fact, true);
});

test("reduce finalization closes accumulator placeholders before publishing the immutable native callback contract", () => {
  const input = { ...selection(integer, [{ kind: "closure", args: [inferred, integer], result: inferred }, inferred]),
    callback: { shape: "reduce", sourceArgumentIndex: 0, accumulatorArgumentIndex: 1,
      failure: { kind: "invocation", resultError: { kind: "callback" }, fallibleTarget: { form: "receiver-method", name: "try_reduce" } } } };
  const callback = { kind: "closure", args: [integer, integer], result: integer };
  const selected = finalizeRustCallbackOperation(input, [callback, integer]);
  assert.equal(selected !== undefined, true);
  assert.deepEqual(selected.parameterCarriers, [callback, integer]);
  assert.deepEqual(selected.fact.parameterCarriers, [callback, integer]);
  assert.equal(selected.resultCarrier === integer, true);
  assert.equal(input.parameterCarriers[0].args[0] === inferred, true, "the original operation template is not mutated");
  assert.equal(input.parameterCarriers[0].result === inferred, true);
  for (const arguments_ of [[], [callback], [callback, number], [{ ...callback, result: number }, integer],
    [{ ...callback, args: [number, integer] }, integer]]) {
    assert.equal(finalizeRustCallbackOperation(input, arguments_) === undefined, true, "inconsistent or missing accumulator evidence rejects");
  }
});

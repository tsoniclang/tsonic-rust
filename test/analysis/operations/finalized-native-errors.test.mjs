import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from
  "../../../dist/analysis/facts/finalized-operation-abi.js";
import { finalizeProviderOperationFact } from
  "../../../dist/analysis/operations/provider/calls/template-instantiation.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const native = { kind: "target-named", id: "acme.NativeError" };
const options = {
  operationKind: "method", form: { form: "call", path: "acme::emit" },
  sourceArgumentCarriers: [], resultCarrier: { kind: "source-primitive", name: "bool" },
  isAsync: false, isFallible: true, errorBoundary: "source-program",
  nativeErrorCarriers: [native],
};

test("final ABI transports native failures through its one selected source-program effect", () => {
  const abi = finalizeRustProviderOperationAbi(options);
  assert.equal(abi !== undefined, true);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  assert.deepEqual(abi.effects.nativeErrorCarriers, [native]);
  assert.equal(abi.effects.errorBoundary, "source-program");
  assert.equal(abi.effects.invocation, "fallible");
  assert.equal(Object.hasOwn(abi.effects, "errorCarrier"), false);
});

test("final ABI rejects mutated native failures, open generics and wrong ownership", () => {
  const abi = finalizeRustProviderOperationAbi(options);
  assert.equal(abi !== undefined, true);
  const sparse = []; sparse.length = 1;
  const accessor = Object.defineProperty({}, "kind", { enumerable: true, get() { throw new Error("must not execute"); } });
  for (const nativeErrorCarriers of [undefined, null, [], {}, sparse, [accessor], [native, native],
    [{ kind: "source-primitive", name: "float64" }], [{ kind: "target-named", id: "rust.program.TsonicError" }],
    [{ ...native, genericArguments: [{ kind: "type", type: { kind: "type-parameter", identity: "free", name: "T" } }] }],
    [{ ...native, genericArguments: [{ kind: "lifetime", lifetime: { kind: "parameter", identity: "free", name: "a" } }] }],
    [{ ...native, genericArguments: [{ kind: "const", value: { kind: "parameter", identity: "free", name: "N" } }] }]]) {
    assert.equal(finalizeRustProviderOperationAbi({ ...options, nativeErrorCarriers }) === undefined, true);
    assert.equal(validateRustFinalizedOperationAbi({ ...abi, effects: { ...abi.effects, nativeErrorCarriers } }), false);
  }
  for (const effects of [{ ...abi.effects, errorBoundary: "target-runtime" },
    { ...abi.effects, errorBoundary: "provider-native", errorCarrier: native },
    { ...abi.effects, invocation: "infallible" }, { ...abi.effects, extra: true }]) {
    assert.equal(validateRustFinalizedOperationAbi({ ...abi, effects }), false);
  }
  const { nativeErrorCarriers, ...ordinary } = options;
  const plain = finalizeRustProviderOperationAbi(ordinary);
  assert.equal(plain !== undefined, true);
  assert.equal(Object.hasOwn(plain.effects, "nativeErrorCarriers"), false);
});

test("template finalization never erases explicitly malformed native-error evidence", () => {
  const template = { kind: "provider-operation", operationId: "acme.emit", operationKind: "method",
    target: options.form, resultCarrier: options.resultCarrier, parameterCarriers: [],
    isAsync: false, isFallible: true, errorBoundary: "source-program", nativeErrorCarriers: [native] };
  const selected = finalizeProviderOperationFact(template, [], undefined, emptyRustTypeDefinitions);
  assert.equal(selected !== undefined, true);
  assert.deepEqual(selected.abi.effects.nativeErrorCarriers, [native]);
  for (const nativeErrorCarriers of [undefined, null, [], [native, native]]) {
    assert.equal(finalizeProviderOperationFact({ ...template, nativeErrorCarriers },
      [], undefined, emptyRustTypeDefinitions) === undefined, true);
  }
});

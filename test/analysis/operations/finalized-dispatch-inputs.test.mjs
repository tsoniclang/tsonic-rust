import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from
  "../../../dist/analysis/facts/finalized-operation-abi.js";
import { finalizeProviderOperationFact } from
  "../../../dist/analysis/operations/provider/calls/template-instantiation.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { analyzeRustDispatchContextCatalog } from "../../../dist/analysis/runtime/dispatch-contexts.js";
import { collectRustProviderSemanticsFromDefinitions } from "../../../dist/providers/packages/index.js";
import { dispatchProviderDefinition } from "../../helpers/rust-session/provider-dispatch-contexts.mjs";
import { rustFoundationForFinalizedOperationAbi } from "../../../dist/analysis/foundation/conversion-requirements.js";

const integer = { kind: "source-primitive", name: "int32" };
const unit = { kind: "tuple", elements: [] };
const contexts = collectRustProviderSemanticsFromDefinitions([dispatchProviderDefinition()]).dispatchContexts;
const catalogResult = analyzeRustDispatchContextCatalog(contexts, ["acme_dispatch"]);
assert.equal(catalogResult.kind, "resolved");
const catalog = catalogResult.plan;
const request = { contextId: "acme.dispatch", view: "root", targetArgumentIndex: 1, mode: "ref" };
const rootInput = catalog.resolveInput(request);
assert.equal(rootInput !== undefined, true);
const base = {
  operationKind: "method", form: { form: "call", path: "acme_dispatch::accept" },
  sourceArgumentCarriers: [integer, integer], resultCarrier: unit,
  isAsync: false, isFallible: false, dispatchInputs: [rootInput],
};

test("source-module constructors retain exact source slots around selected context roots", () => {
  const string = { kind: "target-named", id: "rust.std.String" };
  const form = { form: "source-module-construction", path: "acme_dispatch::Worker::create",
    sourceArgumentIndex: 0, targetArgumentIndex: 1, argOrder: [1, 0],
    bootstrap: { id: "acme.worker", path: "acme_dispatch::bootstrap", errorBoundary: "target-runtime" } };
  for (const position of [0, 1, 2]) {
    const root = catalog.resolveInput({ ...request, targetArgumentIndex: position });
    const abi = finalizeRustProviderOperationAbi({ ...base, operationKind: "constructor", form,
      sourceArgumentCarriers: [string, integer], dispatchInputs: [root] });
    assert.equal(abi !== undefined, true, `root position ${position}`);
    assert.equal(validateRustFinalizedOperationAbi(abi), true);
    assert.deepEqual(abi.targetArguments.filter(input => input.source.kind === "argument")
      .map(input => input.source.sourceIndex), [1, 0]);
    const selected = abi.targetArguments.findIndex(input => input.source.kind === "argument" && input.source.sourceIndex === 0);
    assert.equal(selected, position <= 1 ? 2 : 1);
    assert.equal(abi.target.sourceArgumentIndex, 0);
    assert.equal(abi.target.targetArgumentIndex, 1);
    assert.equal(abi.targetArguments[position].source.kind, "dispatch-context");
  }
});

test("native dispatch inputs interleave with, but never manufacture, authored source slots", () => {
  const abi = finalizeRustProviderOperationAbi(base);
  assert.equal(abi !== undefined, true);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  assert.equal(rustFoundationForFinalizedOperationAbi(abi), "std");
  assert.deepEqual(abi.sourceArguments.map(input => input.sourceIndex), [0, 1]);
  assert.deepEqual(abi.targetArguments.map(input => input.source.kind), ["argument", "dispatch-context", "argument"]);
  assert.deepEqual(abi.targetArguments[1].source, { kind: "dispatch-context", contextId: "acme.dispatch", view: "root" });
  assert.equal(abi.targetArguments[1].parameterCarrier.kind, "reference");
  assert.equal(Object.isFrozen(abi.dispatchInputs[0]), true);
  assert.equal(Object.isFrozen(abi.dispatchInputs[0].carrier), true);
  for (const value of [abi.dispatchInputs, abi.targetArguments[1], abi.targetArguments[1].source,
    abi.targetArguments[1].parameterCarrier]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => abi.dispatchInputs.push(rootInput), TypeError);
  assert.throws(() => { abi.targetArguments[1].source.contextId = "other"; }, TypeError);
});

test("finalized operations publish one immutable snapshot independent of caller aliases", () => {
  for (const dispatchInputs of [[], [rootInput]]) {
    const carrier = { ...integer };
    const form = { ...base.form };
    const abi = finalizeRustProviderOperationAbi({ ...base, form,
      sourceArgumentCarriers: [carrier, carrier], resultCarrier: carrier, dispatchInputs });
    assert.equal(abi !== undefined, true);
    const verifyFrozen = value => {
      if (value === null || typeof value !== "object") return;
      assert.equal(Object.isFrozen(value), true);
      for (const nested of Object.values(value)) verifyFrozen(nested);
    };
    verifyFrozen(abi);
    carrier.name = "int64";
    form.path = "acme_dispatch::different";
    assert.equal(abi.sourceArguments[0].carrier.name, "int32");
    assert.equal(abi.result.carrier.name, "int32");
    assert.equal(abi.target.path, "acme_dispatch::accept");
    assert.equal(validateRustFinalizedOperationAbi(abi), true);
    assert.throws(() => { abi.sourceArguments[0].carrier.name = "int64"; }, TypeError);
    assert.throws(() => { abi.effects.evaluation = "pure"; }, TypeError);
    assert.throws(() => { abi.target.path = "acme_dispatch::different"; }, TypeError);
  }
});

test("native roots borrow once while weak handles have independent owned or borrowed modes", () => {
  for (const mode of ["value", "ref"]) {
    const handle = catalog.resolveInput({ ...request, view: "handle", mode, targetArgumentIndex: 0 });
    const abi = finalizeRustProviderOperationAbi({ ...base, dispatchInputs: [handle, { ...rootInput, targetArgumentIndex: 3 }] });
    assert.equal(abi !== undefined, true);
    assert.equal(validateRustFinalizedOperationAbi(abi), true);
    assert.equal(abi.targetArguments[0].mode, mode);
    assert.equal(abi.targetArguments[0].parameterCarrier.kind === "reference", mode === "ref");
    assert.deepEqual(abi.targetArguments.map(input => input.source.kind),
      ["dispatch-context", "argument", "argument", "dispatch-context"]);
  }
});

test("receiver calls interleave native roots without changing receiver or authored correspondence", () => {
  const receiver = { kind: "target-named", id: "acme.Receiver" };
  for (const mutable of [false, true]) {
    for (const position of [0, 1, 2]) {
      const input = catalog.resolveInput({ ...request, targetArgumentIndex: position });
      const options = { ...base, form: {
        form: "receiver-method", name: "accept", mutatesReceiver: mutable, argOrder: [1, 0],
      }, sourceReceiverCarrier: receiver, dispatchInputs: [input] };
      const abi = finalizeRustProviderOperationAbi(options);
      assert.equal(abi !== undefined, true, `receiver root position ${position}`);
      assert.equal(validateRustFinalizedOperationAbi(abi), true);
      assert.equal(abi.targetReceiver.kind, "input");
      assert.equal(abi.targetReceiver.input.source.kind, "receiver");
      assert.equal(abi.targetReceiver.input.mode, mutable ? "mut-ref" : "ref");
      assert.equal(abi.targetArguments[position].source.kind, "dispatch-context");
      assert.deepEqual(abi.targetArguments.filter(slot => slot.source.kind === "argument")
        .map(slot => slot.source.sourceIndex), [1, 0]);
      assert.deepEqual(abi.sourceArguments.map(slot => slot.sourceIndex), [0, 1]);
      assert.equal(Object.isFrozen(abi.targetReceiver.input), true);
      assert.equal(finalizeRustProviderOperationAbi({ ...options, evaluation: "pure" }) === undefined, true);
      assert.equal(validateRustFinalizedOperationAbi({ ...abi, dispatchInputs: [] }), false);
      assert.equal(validateRustFinalizedOperationAbi({ ...abi, targetArguments: [
        ...abi.targetArguments.slice(0, position), ...abi.targetArguments.slice(position + 1),
      ] }), false);
    }
  }
});

test("dispatch selections reject malformed, sparse, executable and inconsistent native metadata", () => {
  const sparse = []; sparse.length = 1;
  const accessor = Object.defineProperty({}, "contextId", { get() { throw new Error("must not execute"); } });
  const mutations = [null, {}, sparse, [accessor], [{ ...rootInput, mode: "value" }],
    [{ ...rootInput, mode: "mut-ref" }], [{ ...rootInput, view: "unknown" }],
    [{ ...rootInput, contextId: "" }], [{ ...rootInput, targetArgumentIndex: -1 }],
    [{ ...rootInput, targetArgumentIndex: 0.5 }], [{ ...rootInput, targetArgumentIndex: Infinity }],
    [{ ...rootInput, targetArgumentIndex: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...rootInput, targetArgumentIndex: 3 }], [rootInput, rootInput],
    [{ ...rootInput, extra: true }], [{ ...rootInput, carrier: integer }],
    [{ ...rootInput, carrier: { kind: "unknown" } }]];
  for (const [index, dispatchInputs] of mutations.entries()) {
    assert.equal(finalizeRustProviderOperationAbi({ ...base, dispatchInputs }) === undefined, true, `mutation ${index}`);
  }
  assert.equal(finalizeRustProviderOperationAbi({ ...base, evaluation: "pure" }) === undefined, true);
  assert.equal(finalizeRustProviderOperationAbi({ ...base, form: { form: "free-call", path: "acme_dispatch::accept" } }) === undefined, true);
});

test("one current ABI rejects missing context evidence and mutated finalized correspondence", () => {
  const abi = finalizeRustProviderOperationAbi(base);
  assert.equal(abi !== undefined, true);
  const { dispatchInputs, ...obsolete } = abi;
  const target = abi.targetArguments[1];
  const mutations = [obsolete, { ...abi, dispatchInputs: [] }, { ...abi, effects: { ...abi.effects, evaluation: "pure" } },
    { ...abi, dispatchInputs: [{ ...dispatchInputs[0], targetArgumentIndex: 0 }] },
    ...[{ ...target, mode: "value" }, { ...target, carrier: integer },
      { ...target, parameterCarrier: integer }, { ...target, source: { ...target.source, contextId: "other" } },
      { ...target, source: { ...target.source, view: "handle" } }, { ...target, extra: true }]
      .map(input => ({ ...abi, targetArguments: [abi.targetArguments[0], input, abi.targetArguments[2]] }))];
  for (const [index, mutation] of mutations.entries()) {
    assert.equal(validateRustFinalizedOperationAbi(mutation), false, `mutation ${index}`);
  }
});

test("provider facts require the owning catalog query and retain exact native context carriers", () => {
  const template = {
    kind: "provider-operation", operationId: "acme.accept", operationKind: "method", target: base.form,
    isAsync: false, isFallible: false, errorBoundary: "none",
    resultCarrier: unit, parameterCarriers: [integer, integer], dispatchInputs: [request],
  };
  assert.equal(finalizeProviderOperationFact(template, [integer, integer], undefined, emptyRustTypeDefinitions) === undefined, true);
  assert.equal(finalizeProviderOperationFact(template, [integer, integer], undefined, emptyRustTypeDefinitions,
    undefined, () => undefined) === undefined, true);
  const fact = finalizeProviderOperationFact(template, [integer, integer], undefined, emptyRustTypeDefinitions,
    undefined, input => catalog.resolveInput(input));
  assert.equal(fact !== undefined, true);
  assert.deepEqual(fact.abi.dispatchInputs, [rootInput]);
  assert.equal(validateRustFinalizedOperationAbi(fact.abi), true);
});

import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { createRustNativeOutwardResults } from "../../../dist/analysis/callables/native/native-outward-results.js";



import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { rustNativeCallableInputPhysicalSignature } from "../../../dist/policy/conversions/native-callables.js";
import { rustNativeCallableInvocationArguments } from "../../../dist/policy/types/callables/native-invocations.js";
import { rustPhysicalPayloadFor } from "../../../dist/policy/conversions/physical-payloads.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustNativeCallableCompletion } from "../../../dist/policy/types/callables/native-completion.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";

function fixture(text, surfaces = []) {
  const context = analyzeRustErrorEffects(text, { surfaces });
  const producers = context.callableValues.nativeProducers;
  const declaration = name => producers.producers.find(({ declaration }) => context.ast.name(declaration) !== undefined &&
    context.ast.text(context.ast.name(declaration)) === name)?.declaration;
  return { context, producers, declaration };
}

function futureOutput(carrier) {
  assert.equal(carrier?.kind, "impl-trait", "one exact native Future carrier");
  assert.equal(Object.isFrozen(carrier), true);
  const bounds = carrier.bounds.filter(bound => bound.kind === "trait-ref" && bound.id === "rust.core.Future");
  assert.equal(bounds.length, 1);
  const outputs = bounds[0].associatedConstraints.filter(constraint => constraint.identity === "rust.core.Future.Output");
  assert.equal(outputs.length, 1);
  return outputs[0].type;
}

for (const reversed of [false, true]) {
  test(`returned native callable inputs bind each physical result without exporting the callee binder (${reversed ? "reversed" : "source"} order)`, () => {
    const declarations = ["const pure = make(noop, 7);", "const failing = make(failure, 7);"];
    const { result } = compileRust({ files: { "index.ts": `
      function make<Value>(done: (value: Value) => void, value: Value): () => void {
        return () => { done(value); };
      }
      function noop(value: number): void { void value; }
      function failure(value: number): void { if (value > 0) throw "failure"; }
      export function run(): void {
        ${(reversed ? [...declarations].reverse() : declarations).join("\n")}
        pure();
        failing();
      }
    ` } });
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    const program = result.program;
    const ast = program.source.ast;
    const make = program.callableValues.nativeProducers.producers.find(producer =>
      ast.name(producer.declaration) !== undefined && ast.text(ast.name(producer.declaration)) === "make")?.declaration;
    assert.equal(make !== undefined, true, "the original generic producer is retained");
    const inputs = program.callableValues.native.inputsFor(make);
    assert.equal(inputs.length, 1, "one actual native callback input");
    const identity = inputs[0].implementation.identity;
    const outward = program.callableValues.nativeProducers.outwardReturnFor(make);
    assert.equal(outward !== undefined, true, "the callee has its selected native return");
    assert.equal(rustTargetGenericReferences(outward).typeIdentities.includes(identity), true,
      "the callee still owns and binds its native implementation parameter");
    const bindings = new Map();
    const visit = node => {
      const binding = program.records.localBinding.get(node);
      if (binding?.kind === "value" && (binding.name === "pure" || binding.name === "failing")) bindings.set(binding.name, binding);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const file of program.sourceFiles) visit(file);
    assert.equal(bindings.size, 2, "both original checked caller bindings remain distinct");
    const signatures = [];
    for (const [name, binding] of bindings) {
      assert.equal(rustTargetGenericReferences(binding.nativeCarrier).typeIdentities.includes(identity), false,
        `${name}: the native result cannot retain the callee's unbound implementation parameter`);
      const signature = rustCallablePhysicalSignature(binding.nativeCarrier);
      assert.equal(signature !== undefined, true, `${name}: exact physical callable signature`);
      signatures.push(signature);
    }
    assert.equal(rustTargetTypeRefEquals(signatures[0].error, signatures[1].error), false,
      "identical logical argument types retain their distinct actual producer error channels");
  });
}

test("native outward results distinguish pure async T from fallible Result<T,producer E>", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export async function pure(): Promise<int32> { return 3; }
    export async function failed(): Promise<int32> { throw "failure"; }`);
  const pure = current.declaration("pure");
  const failed = current.declaration("failed");
  const output = futureOutput(current.producers.invocationResultFor(pure));
  assert.equal(rustTargetTypeRefEquals(output, current.producers.outwardReturnFor(pure)), true, "pure native output stays T");
  const failure = rustNamedTypeCarrierValue(futureOutput(current.producers.invocationResultFor(failed)));
  assert.equal(failure?.id, "rust.core.Result");
  const error = rustProducerErrorReference(failure.genericArguments[1].type);
  assert.equal(error?.channel, 0);
  assert.equal(current.producers.forIdentity(error.identity)?.declaration === failed, true, "body error keeps producer identity");
  assert.equal(current.producers.invocationResultFor({}) === undefined, true, "foreign declarations rejected");
});

test("JS outward results contain only the exact completion payload rather than task lifetime or producer error", () => {
  const current = fixture(`export async function pure(): Promise<string> { return "value"; }`, ["js"]);
  const declaration = current.declaration("pure");
  const asynchronous = current.context.records.asyncFunction.get(declaration);
  const value = current.producers.invocationResultFor(declaration);
  assert.equal(value?.id, "rust.js.JsPromise");
  assert.equal(value.genericArguments.length, 1);
  assert.deepEqual(value.genericArguments[0], asynchronous.futureCarrier.genericArguments[0]);
  assert.equal(rustTargetTypeRefEquals(value.genericArguments[0].type, current.producers.outwardReturnFor(declaration)), true);
  assert.equal(value.genericArguments.some(argument => argument.kind === "lifetime" ||
    argument.kind === "type" && rustProducerErrorReference(argument.type) !== undefined), false);
});

test("native body completion uses the existing Future owner and its independent exact body-error channel", () => {
  for (const surfaces of [[], ["js"]]) {
    const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
      export async function pure(): Promise<int32> { return 3; }
      export async function failed(): Promise<int32> { throw "failure"; }
      export function forward(): Promise<int32> { return failed(); }`, surfaces);
    const pure = current.declaration("pure");
    assert.equal(rustTargetTypeRefEquals(futureOutput(current.producers.bodyResultFor(pure)),
      current.producers.outwardReturnFor(pure)), true);
    const failed = current.declaration("failed");
    const result = rustNamedTypeCarrierValue(futureOutput(current.producers.bodyResultFor(failed)));
    assert.equal(result?.id, "rust.core.Result");
    const error = rustProducerErrorReference(result.genericArguments[1].type);
    assert.equal(error?.channel, "body");
    assert.equal(current.producers.forIdentity(error.identity).declaration === failed, true);
    assert.equal(current.producers.bodyResultFor(current.declaration("forward")) === undefined, true);
  }
});

test("contextual async physical invocation preserves the finalized optional union topology", () => {
  const current = fixture(`type Completion = number | Promise<number> | undefined;
    export function make(): () => Completion { return async () => 3; }`, ["js"]);
  const declaration = current.producers.producers.find(producer => current.context.ast.is.IsArrowFunction(producer.declaration))?.declaration;
  assert.equal(declaration !== undefined, true, "one authored async implementation");
  const operation = current.context.records.targetOperation.get(declaration);
  assert.equal(operation.invocationResult !== undefined, true, "one finalized contextual conversion");
  const result = current.producers.invocationResultFor(declaration);
  const completion = rustNativeCallableCompletion(result, current.context.typeDefinitions);
  assert.equal(completion?.selection.kind, "optional");
  assert.equal(completion.selection.present.kind, "union");
  assert.equal(completion.futures.length, 1);
  const physical = current.producers.physicalFor(declaration, operation.resultCarrier);
  const signature = physical === undefined ? undefined : rustCallablePhysicalSignature(physical);
  assert.equal(rustTargetTypeRefEquals(signature?.result, result), true, "one physical invocation result owner");
  const invalid = createRustNativeOutwardResults({ definitions: current.context.typeDefinitions,
    producers: current.producers, returnCarrierFor: current.producers.outwardReturnFor,
    records: createRustRecordFixture({
targetOperation: { get: (node) => {
    const selected = current.context.records.targetOperation.get(node);
    return node === declaration ? { ...selected,
        invocationResult: { ...selected.invocationResult, sourceCarrier: { kind: "source-primitive", name: "int32" } } } : selected;
} }}, current.context.records),
  });
  assert.equal(invalid.invocationFor(declaration) === undefined, true, "foreign conversion sources reject");
});

test("outward carrier queries fail closed before finalized native effects and do not cache that incomplete phase", () => {
  const current = fixture(`export async function pure(): Promise<string> { return "value"; }`);
  const declaration = current.declaration("pure");
  const records = current.context.records;
  let finalized = false;
  const selected = createRustNativeOutwardResults({
    records: createRustRecordFixture({
sourceCallEffects: { get: (node) => { return !finalized ? undefined : records.sourceCallEffects.get(node); } }}, records),
    definitions: current.context.typeDefinitions, producers: current.producers,
    returnCarrierFor(node) {
      const result = current.context.callableValues.nativeStorage.prepareReturn(node);
      return result.kind === "unresolved" ? undefined : result.carrier;
    },
  });
  assert.equal(selected.invocationFor(declaration) === undefined, true, "unknown fallibility cannot become pure output");
  assert.equal(selected.returnFor(declaration) !== undefined, true, "body storage is independent of final error effects");
  finalized = true;
  assert.equal(rustTargetTypeRefEquals(selected.invocationFor(declaration), current.producers.invocationResultFor(declaration)), true);
});

test("sync JS Promise output uses the uniform rejection channel before deferred-effect sealing", () => {
  const current = fixture(`export function forward(callback: () => Promise<string>): Promise<string> { return callback(); }`, ["js"]);
  const declaration = current.declaration("forward");
  const selected = createRustNativeOutwardResults({ records: current.context.records,
    definitions: current.context.typeDefinitions, producers: {
      forDeclaration: current.producers.forDeclaration, errorFor: current.producers.errorFor,
      deferredFor() { throw new Error("JS output shape must not query unfinished deferred effects"); },
    }, returnCarrierFor(node) {
      const result = current.context.callableValues.nativeStorage.prepareReturn(node);
      return result.kind === "unresolved" ? undefined : result.carrier;
    },
  });
  const carrier = selected.invocationFor(declaration);
  assert.equal(carrier?.id, "rust.js.JsPromise");
  assert.equal(carrier.genericArguments.length, 1);
  assert.equal(carrier.genericArguments.some(argument => argument.kind === "type" &&
    rustProducerErrorReference(argument.type) !== undefined), false);
  assert.equal(current.producers.deferredErrorFor(declaration, 0)?.id, "rust.js.JsValue");
});

test("outward result recursion is bounded at the producer owner", () => {
  const current = fixture(`export function pure(): string { return "value"; }`);
  const declaration = current.declaration("pure");
  const selected = createRustNativeOutwardResults({ records: current.context.records,
    definitions: current.context.typeDefinitions, producers: current.producers,
    returnCarrierFor(node) { return selected.returnFor(node); },
  });
  assert.equal(selected.returnFor(declaration) === undefined, true, "recursive result selection fails closed");
});

test("direct stored native Future producers and forwarded generic values retain the exact native output", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    export async function pure(): Promise<int32> { return 3; }
    export async function failed(): Promise<int32> { throw "failure"; }
    export function forwardPure(): Promise<int32> { const value = pure(); return value; }
    export function forwardFailure(): Promise<int32> { return failed(); }
    export async function generic<Value>(value: Value): Promise<Value> { return value; }
    export function selected(value: int32): Promise<int32> { return generic(value); }`);
  for (const [name, result] of [["forwardPure", "int32"], ["forwardFailure", "rust.core.Result"], ["selected", "int32"]]) {
    const output = futureOutput(current.producers.outwardReturnFor(current.declaration(name)));
    assert.equal(rustNamedTypeCarrierValue(output)?.id ?? output.name, result, name);
  }
  const error = rustProducerErrorReference(rustNamedTypeCarrierValue(futureOutput(
    current.producers.outwardReturnFor(current.declaration("forwardFailure")))).genericArguments[1].type);
  assert.equal(current.producers.forIdentity(error.identity)?.declaration === current.declaration("failed"), true,
    "a transported Future does not become a new producer");
});

test("callback Future physical storage reuses canonical protocol completion including selected generic arguments", () => {
  const current = fixture(`import type { int32 } from "@tsonic/core/types.js";
    type Outcome = string | Promise<int32> | undefined;
    export function direct(callback: () => Promise<int32>): Promise<int32> { return callback(); }
    export function selected(callback: <Value>(value: Value) => Promise<Value>, value: int32): Promise<int32> {
      return callback(value);
    }
    export function union(callback: () => Outcome): Outcome { return callback(); }`);
  const { native, nativeStorage } = current.context.callableValues;
  assert.equal(native.calls.length, 3);
  for (const call of native.calls) {
    const operation = current.context.records.targetOperation.get(call.node);
    const callIdentity = sourceNodeIdentity(current.context.ast, call.node);
    assert.equal(callIdentity !== undefined, true, "the native invocation retains its original checked source identity");
    const arguments_ = rustNativeCallableInvocationArguments(call.input, operation, callIdentity);
    assert.equal(arguments_ !== undefined, true);
    const signature = rustNativeCallableInputPhysicalSignature(call.input, arguments_);
    assert.equal(signature !== undefined, true);
    const physical = nativeStorage.valueFor(call.node);
    assert.equal(physical.kind, "selected", physical.reason ?? "exact invocation storage");
    assert.equal(rustTargetTypeRefEquals(physical.carrier, signature.result), true, "one protocol output owner");
    assert.equal(rustNativeCallableInputPhysicalSignature(call.input,
      [...arguments_, { kind: "type", type: { kind: "source-primitive", name: "int32" } }]) === undefined,
    true, "method arity remains exact");
    const [future] = call.completion.futures;
    const selected = rustPhysicalPayloadFor(operation.resultCarrier, physical.carrier, future.carrier, current.context.typeDefinitions);
    const result = rustNamedTypeCarrierValue(futureOutput(selected));
    assert.equal(result?.id, "rust.core.Result");
    assert.equal(rustTargetTypeRefEquals(result.genericArguments[0].type, future.output), true, "actual method output argument");
    assert.equal(result.genericArguments[1].type.name, "AwaitError0");
    assert.equal(rustTargetTypeRefEquals(result.genericArguments[1].type.owner, call.input.implementation), true);
  }
});

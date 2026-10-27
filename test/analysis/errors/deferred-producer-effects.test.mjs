import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";



import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustNativeCallableCompletion } from "../../../dist/policy/types/callables/native-completion.js";
import { mergeRustDeferredProducerChannels } from "../../../dist/analysis/callables/async/deferred-producer-effects.js";
import { finiteCompletionSequencingSource } from "../../../../tsonic/test/fixtures/finite-completion-sequencing.mjs";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph }
  from "../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";

function fixture(text, options = {}) {
  const context = analyzeRustErrorEffects(text, { surfaces: [], ...options });
  const ast = context.ast;
  const declarations = context.callableValues.nativeProducers.producers.map(producer => producer.declaration);
  const declaration = name => {
    const selected = declarations.filter(node => ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
    assert.equal(selected.length, 1, name);
    return selected[0];
  };
  const error = name => {
    const selected = context.callableValues.nativeProducers.deferredErrorFor(declaration(name), 0);
    assert.equal(selected !== undefined, true, `exact deferred error: ${name}`);
    return selected;
  };
  return { context, declaration, error };
}

test("direct, captured and forwarded input futures retain the actual caller error without rebranding its protocol", () => {
  const current = fixture(`
    export function retain(callback: () => Promise<number>) { return callback(); }
    export function forward(callback: () => Promise<number>) { return retain(callback); }
    export function outer(callback: () => Promise<number>) {
      function inner() { return callback(); }
      return inner();
    }
  `);
  const native = current.context.callableValues.native;
  const formal = native.inputsFor(current.declaration("retain"))[0];
  const caller = native.inputsFor(current.declaration("forward"))[0];
  const capture = native.inputsFor(current.declaration("outer"))[0];
  for (const [name, implementation, protocol] of [
    ["retain", formal.implementation, formal.protocol],
    ["forward", caller.implementation, formal.protocol],
    ["inner", capture.implementation, capture.protocol],
    ["outer", capture.implementation, capture.protocol],
  ]) {
    const error = current.error(name);
    assert.equal(error.kind, "associated-type");
    assert.equal(rustTargetTypeRefEquals(error.owner, implementation), true, name);
    assert.equal(error.trait.id, protocol.trait.id, name);
    assert.equal(error.name, "AwaitError0");
    const fact = current.context.records.deferredProducerEffects.get(current.declaration(name));
    assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.channels) && Object.isFrozen(fact.channels[0]) &&
      Object.isFrozen(error), true);
    assert.equal(fact.channels[0].awaiting, "fallible");
    assert.equal(current.context.callableValues.nativeProducers.deferredFor(current.declaration(name), 0),
      fact.channels[0]);
  }
});

test("generic return storage substitutes output and associated error through the same selected activation", () => {
  const current = fixture(`
    export function retain<Value>(callback: () => Promise<Value>) { return callback(); }
    export function forward<Other>(callback: () => Promise<Other>) { return retain(callback); }
    export function concrete(callback: () => Promise<string>) { return forward(callback); }
  `);
  const formal = current.context.callableValues.native.inputsFor(current.declaration("retain"))[0];
  for (const name of ["forward", "concrete"]) {
    const declaration = current.declaration(name);
    const input = current.context.callableValues.native.inputsFor(declaration)[0];
    const error = current.error(name);
    assert.equal(error.kind, "associated-type");
    assert.equal(rustTargetTypeRefEquals(error.owner, input.implementation), true);
    assert.equal(error.trait.id, formal.protocol.trait.id);
    const result = current.context.records.sourceCallableReturn.get(declaration);
    const output = rustNativeCallableCompletion(result.returnCarrier, current.context.typeDefinitions).futures[0].output;
    assert.equal(rustTargetTypeRefEquals(error.trait.genericArguments[0].type, output), true,
      "the original callee binder must not escape in the generic protocol application");
  }
});

test("sync returns of async source calls retain stable producer ownership and pure async evidence", () => {
  const current = fixture(`
    export class RootFailure extends Error { code = 7; }
    export async function failed(): Promise<number> { throw new RootFailure("owned"); }
    export async function succeeded(): Promise<number> { return 7; }
    export function pendingFailure() { return failed(); }
    export function pendingSuccess() { return succeeded(); }
  `);
  const failed = current.context.callableValues.nativeProducers.forDeclaration(current.declaration("failed"));
  const reference = rustProducerErrorReference(current.error("pendingFailure"));
  assert.equal(reference !== undefined, true);
  assert.equal(reference.identity, failed.identity);
  assert.equal(reference.fileName, failed.fileName);
  assert.equal(reference.channel, 0);
  assert.equal(current.error("pendingSuccess").id, rustInfallibleTargetId);
  assert.equal(current.context.callableValues.nativeProducers.deferredFor(current.declaration("pendingSuccess"), 0).awaiting,
    "infallible");
  assert.equal(current.context.callableValues.nativeProducers.deferredFor(current.declaration("pendingFailure"), 0).awaiting,
    "fallible");
  const effects = current.context.records.errorEffects.get(current.declaration("pendingFailure"));
  assert.equal(effects.localErrors, false, "constructing the Future does not execute its body");
  assert.equal(effects.nativeErrors.length, 0);
});

test("a RootFailure producer returned across actual source packages retains its root identity", () => {
  const files = { ...sourcePackageCallbackErrorFiles,
    "node_modules/@acme/failures/index.ts": sourcePackageCallbackErrorFiles["node_modules/@acme/failures/index.ts"] + `
      export function deferred(callback: () => Promise<number>) { return callback(); }
    `,
    "node_modules/@acme/forward/index.ts": sourcePackageCallbackErrorFiles["node_modules/@acme/forward/index.ts"] + `
      import { deferred } from "@acme/failures";
      export function deferredAgain(callback: () => Promise<number>) { return deferred(callback); }
    `,
    "index.ts": sourcePackageCallbackErrorFiles["index.ts"] + `
      import { deferredAgain } from "@acme/forward";
      export class RootFailure extends Error { code = 9; }
      export async function rootFailure(): Promise<number> { throw new RootFailure("root"); }
      export function rootPending() { return deferredAgain(rootFailure); }
    `,
  };
  const current = fixture("", { files, sourcePackages: sourcePackageCallbackErrorGraph });
  const producer = current.context.callableValues.nativeProducers.forDeclaration(current.declaration("rootFailure"));
  const reference = rustProducerErrorReference(current.error("rootPending"));
  assert.equal(reference !== undefined, true);
  assert.equal(reference.identity, producer.identity);
  assert.equal(reference.fileName, producer.fileName);
  assert.equal(reference.channel, 0);
  const forwarded = current.error("deferredAgain");
  assert.equal(forwarded.kind, "associated-type");
  assert.equal(forwarded.owner.identity,
    current.context.callableValues.native.inputsFor(current.declaration("deferredAgain"))[0].implementation.identity);
});

test("no-Future evidence is explicit, while absent facts, foreign owners and invalid ordinals reject", () => {
  const current = fixture(`
    export function scalar(): string { return "value"; }
    export function empty(): void {}
    export function diverging(): never { throw new Error("stop"); }
    export async function asyncBody(): Promise<number> { return 1; }
    export function retained(callback: () => Promise<number>) { return callback(); }
  `);
  const producers = current.context.callableValues.nativeProducers;
  for (const name of ["scalar", "empty", "diverging"]) {
    assert.equal(current.context.records.deferredProducerEffects.get(current.declaration(name)).kind, "no-future");
    assert.equal(current.error(name).id, rustInfallibleTargetId);
    assert.equal(producers.deferredFor(current.declaration(name), 0).awaiting, "infallible");
    assert.equal(producers.deferredFor(current.declaration(name), 1) === undefined, true,
      "a proven scalar/absent implementation has only its explicit ready completion descriptor");
  }
  assert.equal(producers.deferredErrorFor(current.declaration("asyncBody"), 0) === undefined, true,
    "the async body error remains the separate owning declaration's channel");
  assert.equal(producers.deferredErrorFor({}, 0) === undefined, true, "foreign declarations do not become pure");
  for (const ordinal of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1])
    assert.equal(producers.deferredErrorFor(current.declaration("retained"), ordinal) === undefined, true,
      `reject invalid/unselected future ordinal ${ordinal}`);
});

test("deferred channel merging preserves the physical Result shape even when its error is Infallible", () => {
  const errorCarrier = { kind: "target-named", id: rustInfallibleTargetId };
  const plain = { awaiting: "infallible", errorCarrier };
  const result = { awaiting: "fallible", errorCarrier };
  assert.equal(mergeRustDeferredProducerChannels([plain, plain]), plain);
  assert.equal(mergeRustDeferredProducerChannels([result, { ...result }]), result);
  assert.equal(mergeRustDeferredProducerChannels([plain, result]) === undefined, true,
    "Future<T> and Future<Result<T, Infallible>> require different awaiting operations");
  assert.equal(mergeRustDeferredProducerChannels([result, plain]) === undefined, true);
  assert.equal(mergeRustDeferredProducerChannels([]) === undefined, true,
    "absence of producer evidence is not evidence of a plain Future");
  assert.equal(mergeRustDeferredProducerChannels([result, { ...result,
    errorCarrier: { kind: "type-parameter", identity: "exact-error", name: "Error" } }]) === undefined, true,
    "equal physical shapes must also retain exact error identity");
});

test("a mixed completion retains its selected Future's shape rather than the declaration awaiting flag", () => {
  const current = fixture(finiteCompletionSequencingSource);
  const channel = current.context.callableValues.nativeProducers.deferredFor(current.declaration("mutate"), 0);
  assert.equal(channel !== undefined, true);
  assert.equal(channel.awaiting, "fallible");
  assert.equal(channel.errorCarrier.kind, "associated-type");
  assert.equal(channel.errorCarrier.name, "AwaitError0");
  const input = current.context.callableValues.native.inputsFor(current.declaration("snapshot"))[0];
  assert.equal(rustTargetTypeRefEquals(channel.errorCarrier.owner, input.implementation), true);
});

test("bound physical subject selection requires the exact owned storage bindings", () => {
  const current = fixture("export function retained(callback: () => Promise<number>) { return callback(); }", { surfaces: ["js"] });
  const native = current.context.callableValues.native;
  const input = native.inputsFor(current.declaration("retained"))[0];
  const bindings = native.bindingsFor(current.declaration("retained"));
  const selected = current.context.callableValues.nativeStorage.boundSubjectFor(input.subject, input.carrier, bindings);
  assert.equal(selected.kind, "selected");
  assert.equal(selected.carrier.kind, "reference");
  assert.equal(selected.carrier.mutable, false);
  assert.equal(rustTargetTypeRefEquals(selected.carrier.referent, input.implementation), true,
    "the selected borrowed callable preserves its reference around the exact implementation");
  const copied = current.context.callableValues.nativeStorage.boundSubjectFor(input.subject, input.carrier, { ...bindings });
  assert.equal(copied.kind, "unresolved", "a copied view must not acquire binding authority");
});

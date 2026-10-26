import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { analyzeRustSourcePackageComponents } from "../../../dist/analysis/source-modules/component-semantics.js";
import { normalizeRustErrorType, selectRustPhysicalProgramErrorOwner } from "../../../dist/analysis/errors/error-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustJsValueTargetType, rustProgramErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinTargetType, rustNativeErrorJoinReference } from "../../../dist/target-model/types/native-error-joins.js";
import { selectRustErrorRegion } from "../../../dist/analysis/errors/regions.js";
import { nativeCallbackParametersSource } from "../../../../tsonic/test/fixtures/native-callback-parameters.mjs";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustNativeCallableErrorType } from "../../../dist/policy/types/callables/native-protocols.js";
import { rustStaticLifetime } from "../../../dist/target-model/lifetimes/index.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { Node_Expression } from "@tsonic/target-api/source";


function fixture(text = `
    class Failure extends Error {}
    export async function pureLeft(): Promise<string> { return "left"; }
    export async function pureRight(): Promise<string> { return "right"; }
    export async function failLeft(): Promise<string> { throw new Failure("left"); }
    export async function failRight(): Promise<string> { throw new Failure("right"); }
    export function forwarded(): Promise<string> { return failLeft(); }
  `, options = {}) {
  const context = analyzeRustErrorEffects(text, options);
  const classified = analyzeRustSourcePackageComponents(context, "lib", subject => context.records.errorEffects.get(subject));
  assert.equal(classified.kind, "resolved");
  const producers = context.callableValues.nativeProducers;
  const producer = name => producers.producers.find(candidate => {
    const selected = context.ast.name(candidate.declaration);
    return selected !== undefined && context.ast.text(selected) === name;
  });
  const input = { ast: context.ast, records: context.records, definitions: context.typeDefinitions,
    producers, components: classified.plan };
  const error = name => producers.errorFor(producer(name).declaration, name === "forwarded" ? 0 : "body");
  return { input, producer, error, native: context.callableValues.native };
}

test("concrete native Callable invocation errors normalize their bound producer without inventing generic purity", () => {
  const current = fixture(`
    export function invoke(callback: () => string): string { return callback(); }
    export function pure(): string { return "pure"; }
    export function failed(): string { throw new Error("failure"); }
  `);
  const declaration = current.producer("invoke").declaration;
  const inputs = current.native.inputsFor(declaration);
  assert.equal(inputs.length, 1, "the checked declaration has its one actual native input");
  const input = inputs[0];
  assert.equal(input.protocol.method.binder.parameters.length, 0, "the selected invocation has no hidden lifetime arguments");
  assert.equal(input.protocol.signature.typeParameters.length, 0, "the selected invocation has no hidden type arguments");
  const pure = current.input.producers.errorFor(current.producer("pure").declaration, "invoke");
  const failed = current.input.producers.errorFor(current.producer("failed").declaration, "invoke");
  for (const [name, error, expected] of [
    ["pure nested producer", pure, { kind: "target-named", id: "rust.core.Infallible" }],
    ["failed nested producer", failed, normalizeRustErrorType(failed, current.input)],
    ["JS rejection", rustJsValueTargetType(), rustJsValueTargetType()],
  ]) {
    const implementation = rustCallableTargetType([], rustStringTargetType(), rustStaticLifetime, error);
    const associated = rustNativeCallableErrorType(input, implementation, "invocation", []);
    assert.equal(associated !== undefined, true, name + ": the actual native bridge admits the invocation projection");
    assert.equal(expected !== undefined, true, name + ": the original producer owns its exact error");
    const normalized = normalizeRustErrorType(associated, current.input);
    assert.equal(rustTargetTypeRefEquals(normalized, expected), true, name + ": normalization retains the exact bound error");
    assert.equal(Object.isFrozen(normalized), true, name + ": normalized evidence is immutable");
    for (const other of [{ ...associated, name: "AwaitError0" }, { ...associated, trait: { ...associated.trait, id: "foreign:Callable" } }]) {
      assert.equal(normalizeRustErrorType(other, current.input)?.kind, "associated-type",
        name + ": unrelated associated channels are not projected as invocation errors");
    }
  }
  const unbound = rustNativeCallableErrorType(input, input.implementation, "invocation", []);
  assert.equal(unbound !== undefined, true, "the original generic input owns its independent invocation channel");
  assert.equal(rustTargetTypeRefEquals(normalizeRustErrorType(unbound, current.input), unbound), true,
    "a native implementation binder is never guessed to be infallible");
});

test("returned native callback calls publish the bound observer and resolver error before sealing", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    function make<Part>(done: (value: Part) => void, value: Part): () => void {
      return () => { done(value); };
    }
    function wrap<Value>(value: Value): Promise<Value | number> {
      return new Promise<Value | number>(resolve => {
        const observer = make((actual: Value): void => { void actual; }, value);
        const completion = make(resolve, 7);
        new Set([observer]).forEach(next => { next(); });
        observer();
        completion();
      });
    }
    console.log(await wrap(Promise.resolve(5)));
  ` } });
  const { ast } = program.source;
  const found = new Set();
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      const callee = Node_Expression(ast, node);
      const name = callee !== undefined && ast.is.IsIdentifier(callee) ? ast.text(callee) : undefined;
      if (name === "observer" || name === "completion") {
        const selected = program.records.sourceCall.get(node);
        assert.equal(selected !== undefined, true, name + ": the actual call owns its sealed native selection");
        assert.equal(selected.eliminateInfallible, name === "observer", name + ": only the pure actual creation eliminates Infallible");
        assert.equal(name === "observer" ? selected.physicalCallableError === undefined
          : rustTargetTypeRefEquals(selected.physicalCallableError, rustJsValueTargetType()), true,
        name + ": no program-error transport replaces the actual native channel");
        found.add(name);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(found.size, 2, "both independent actual creation channels are checked before publication");
});

test("native declaration error demand removes only template-proven impossible channels and retains Result ABI", () => {
  const current = fixture(nativeCallbackParametersSource, { surfaces: [] });
  const declaration = current.producer("run").declaration;
  const effects = current.input.records.errorEffects.get(declaration);
  assert.equal(effects.nativeErrors.length, 2, "original source channel identities are not erased");
  const selected = selectRustErrorRegion(declaration, effects, { ...current.input, promiseBodies: { objects: new Map() } }, false);
  assert.equal(selected.kind, "resolved", "the canonical declaration owns its exact physical error selection");
  assert.equal(selected.value.kind, "native", "the original native Result call ABI is retained");
  assert.equal(selected.value.sources.length, 0, "both actual impossible declaration channels need no enum variants");
  const error = current.input.producers.errorFor(declaration, "invoke");
  const normalized = normalizeRustErrorType(error, current.input);
  assert.equal(normalized?.id, "rust.core.Infallible", "native producer and declaration choose the identical error carrier");
  const generic = current.producer("consume").declaration;
  const genericError = normalizeRustErrorType(current.input.producers.errorFor(generic, "invoke"), current.input);
  assert.equal(genericError !== undefined && genericError.id !== "rust.core.Infallible", true,
    "an unbound callback error remains an actual independent generic channel");
  const joined = rustNativeErrorJoinTargetType("/native-template.ts", [normalized, normalized]);
  assert.equal(rustNativeErrorJoinReference(normalizeRustErrorType(joined, current.input))?.errors.length, 2,
    "a previously selected generic join is never collapsed merely from bound Infallible arguments");
});

test("native body errors normalize independently from the single JS Promise rejection boundary", () => {
  const current = fixture();
  const pure = ["pureLeft", "pureRight"].map(name => normalizeRustErrorType(current.error(name), current.input));
  assert.equal(pure.every(carrier => carrier?.id === "rust.core.Infallible"), true);
  assert.equal(rustTargetTypeRefEquals(...pure), true);
  const failed = ["failLeft", "failRight"].map(name => normalizeRustErrorType(current.error(name), current.input));
  assert.equal(failed.every(carrier => carrier?.errorOwner?.kind === "physical" && carrier.errorOwner.domain === "project"), true);
  assert.equal(failed.every(carrier => rustTargetTypeRefEquals(carrier, failed[0])), true);
  assert.equal(rustTargetTypeRefEquals(current.error("failLeft"), current.error("failRight")), false,
    "distinct producers stay distinct symbolic references before normalization");
  const forwarded = normalizeRustErrorType(current.error("forwarded"), current.input);
  assert.equal(rustTargetTypeRefEquals(forwarded, rustJsValueTargetType()), true,
    "synchronous forwarding retains the concrete Promise object's one JS rejection carrier");
  const completion = current.input.producers.invocationResultFor(current.producer("failLeft").declaration);
  const output = current.input.records.asyncFunction.get(current.producer("failLeft").declaration)?.outputCarrier;
  assert.equal(output !== undefined, true, "the checked async declaration owns its actual native payload selection");
  assert.equal(rustTargetTypeRefEquals(output, rustStringTargetType()), true,
    "the authored Promise<string> payload uses ordinary native String, not the JS UTF-16 wrapper");
  const selected = normalizeRustErrorType(completion, current.input);
  assert.equal(selected?.id, "rust.js.JsPromise");
  assert.equal(selected.genericArguments.length, 1, "the actual Promise object has only its payload argument");
  assert.equal(selected.genericArguments[0].kind, "type", "the payload is a native type argument");
  assert.equal(rustTargetTypeRefEquals(completion.genericArguments[0].type, output), true,
    "the actual Promise producer carries the checked native payload, not a guessed JS storage carrier");
  assert.equal(rustTargetTypeRefEquals(selected.genericArguments[0].type, output), true,
    "Promise output stays separate from exact native body errors and the shared JS rejection carrier");
});

test("logical errors require a declaration-local owner and foreign physical owners never fall back to ambient scope", () => {
  const current = fixture();
  const logical = rustProgramErrorTargetType();
  assert.equal(normalizeRustErrorType(logical, current.input) === undefined, true);
  const declaration = current.producer("failLeft").declaration;
  const owner = selectRustPhysicalProgramErrorOwner(declaration, current.input);
  assert.equal(owner?.kind, "physical");
  assert.equal(rustTargetTypeRefEquals(normalizeRustErrorType(logical, current.input, declaration), rustProgramErrorTargetType(owner)), true);
  const foreign = rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "foreign" });
  assert.equal(normalizeRustErrorType(foreign, current.input, declaration) === undefined, true);
  const missing = { ...current.input, components: { ...current.input.components, componentForFile: () => undefined } };
  assert.equal(normalizeRustErrorType(current.error("failLeft"), missing) === undefined, true);
});

test("normalization rejects incomplete producer effects, recursive aliases and excessive work rather than inventing purity", () => {
  const current = fixture();
  const declaration = current.producer("failLeft").declaration;
  const carrier = current.error("failLeft");
  for (const effects of [undefined, { localErrors: false, nativeErrors: [{ identity: "cycle", errorType: carrier }] }]) {
    const input = { ...current.input, records: createRustRecordFixture({
errorEffects: { get: (node) => node === declaration
    ? effects : current.input.records.errorEffects.get(node) }}, current.input.records) };
    assert.equal(normalizeRustErrorType(carrier, input) === undefined, true);
  }
  assert.equal(rustProducerErrorReference(carrier).identity.length > 0, true);
  assert.equal(normalizeRustErrorType({ kind: "tuple", elements: Array.from({ length: 4097 }, () =>
    ({ kind: "source-primitive", name: "int32" })) }, current.input) === undefined, true);
});

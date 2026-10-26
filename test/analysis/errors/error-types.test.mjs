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
  return { input, producer, error };
}

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

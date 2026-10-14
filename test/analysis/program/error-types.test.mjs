import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { analyzeRustSourcePackageComponents } from "../../../dist/analysis/program/source-package-components.js";
import { normalizeRustErrorType, selectRustPhysicalProgramErrorOwner } from "../../../dist/analysis/program/error-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustProgramErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";


function fixture() {
  const context = analyzeRustErrorEffects(`
    class Failure extends Error {}
    export async function pureLeft(): Promise<string> { return "left"; }
    export async function pureRight(): Promise<string> { return "right"; }
    export async function failLeft(): Promise<string> { throw new Failure("left"); }
    export async function failRight(): Promise<string> { throw new Failure("right"); }
    export function forwarded(): Promise<string> { return failLeft(); }
  `);
  const classified = analyzeRustSourcePackageComponents(context, "lib");
  assert.equal(classified.kind, "resolved");
  const producers = context.callableValues.nativeProducers;
  const producer = name => producers.producers.find(candidate => {
    const selected = context.ast.name(candidate.declaration);
    return selected !== undefined && context.ast.text(selected) === name;
  });
  const input = { ast: context.ast, records: context.records, definitions: context.typeDefinitions,
    producers, components: classified.plan };
  const error = name => producers.errorFor(producer(name).declaration, 0);
  return { input, producer, error };
}

test("closed producer error aliases normalize to pure or exact component-owned carriers, including synchronous forwarding", () => {
  const current = fixture();
  const pure = ["pureLeft", "pureRight"].map(name => normalizeRustErrorType(current.error(name), current.input));
  assert.equal(pure.every(carrier => carrier?.id === "rust.core.Infallible"), true);
  assert.equal(rustTargetTypeRefEquals(...pure), true);
  const failed = ["failLeft", "failRight", "forwarded"].map(name => normalizeRustErrorType(current.error(name), current.input));
  assert.equal(failed.every(carrier => carrier?.errorOwner?.kind === "physical" && carrier.errorOwner.domain === "project"), true);
  assert.equal(failed.every(carrier => rustTargetTypeRefEquals(carrier, failed[0])), true);
  assert.equal(rustTargetTypeRefEquals(current.error("failLeft"), current.error("failRight")), false,
    "distinct producers stay distinct symbolic references before normalization");
  const completion = current.input.producers.invocationResultFor(current.producer("failLeft").declaration);
  const selected = normalizeRustErrorType(completion, current.input);
  assert.equal(selected?.id, "rust.js.JsPromise");
  assert.equal(rustTargetTypeRefEquals(selected.genericArguments[2].type, failed[0]), true);
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

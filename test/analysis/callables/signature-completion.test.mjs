import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { finalizeRustCallableSignature, resolveRustCallableSignatureCarrier } from "../../../dist/analysis/callables/signature-query.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function fixture(inherit, source = "export async function step(value: number): Promise<number> { return value; }", surfaces = ["js"]) {
  const { context, walk } = analyzeRustOperations(source, { surfaces });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  assert.equal(declaration !== undefined, true);
  const inherited = inherit ? context.records : createRustRecordFixture(Object.fromEntries(
    ["asyncFunction", "generator", "sourceCallableReturn", "retainedEnvironment"].map(family =>
      [family, { get: node => node === declaration ? undefined : context.records[family].get(node) }])), context.records);
  const current = createRustCarrierProbe({ ...walk, context: { ...context,
    records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  let admissions = 0;
  const records = current.context.records;
  return { declaration, current: { ...current, context: { ...current.context, records: { ...records,
    asyncFunctions: { ...records.asyncFunctions,
      promise(...arguments_) { admissions++; return records.asyncFunctions.promise(...arguments_); },
      native(...arguments_) { admissions++; return records.asyncFunctions.native(...arguments_); },
    },
    generators: { ...records.generators,
      suspend(...arguments_) { admissions++; return records.generators.suspend(...arguments_); },
    },
  } } }, admissions: () => admissions };
}

for (const inherited of [false, true]) test(`complete source signatures reuse ${inherited ? "inherited" : "local"} native suspension facts`, () => {
  const input = fixture(inherited);
  assert.equal(resolveRustCallableSignatureCarrier(input.current, input.declaration) !== undefined, true);
  const suspension = input.current.context.records.asyncFunction.get(input.declaration);
  const result = input.current.context.records.sourceCallableReturn.get(input.declaration);
  assert.equal(suspension !== undefined && result !== undefined, true);
  assert.equal(resolveRustCallableSignatureCarrier(input.current, input.declaration) !== undefined, true);
  assert.equal(input.current.context.records.asyncFunction.get(input.declaration) === suspension, true);
  assert.equal(input.current.context.records.sourceCallableReturn.get(input.declaration) === result, true);
  assert.equal(input.admissions(), inherited ? 0 : 1, "actual native constructor admissions are not query hits");
});

for (const [name, source, surfaces] of [
  ["native future", "export async function step(value: number): Promise<number> { return value; }", []],
  ["generator", "export function* step(value: number): Generator<number, number, number> { yield value; return value; }", []],
  ["async generator", "export async function* step(value: number): AsyncGenerator<number, number, number> { yield value; return value; }", ["js"]],
]) for (const inherited of [false, true]) test(`complete ${name} signatures reuse ${inherited ? "inherited" : "local"} native facts`, () => {
  const input = fixture(inherited, source, surfaces);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected !== undefined && selected.suspension !== undefined, true);
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration) === selected, true);
  assert.equal(input.admissions(), inherited ? 0 : 1);
  if (name !== "native future") {
    assert.equal(input.current.context.records.asyncFunction.get(input.declaration) === undefined, true,
      "a generator cannot also acquire an ordinary async fact");
    assert.equal(input.current.context.records.generator.get(input.declaration) === selected.suspension, true);
  }
});

test("a completed full signature is a canonical lookup and rejects closed access before metadata", () => {
  const input = fixture(false);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected !== undefined, true);
  let reads = 0;
  const lookup = { ...input.current, context: { ...input.current.context,
    get ast() { reads++; throw new Error("metadata read during completed lookup"); },
    semanticsFor() { reads++; throw new Error("source selection during completed lookup"); },
  } };
  assert.equal(finalizeRustCallableSignature(lookup, input.declaration) === selected, true);
  assert.equal(resolveRustCallableSignatureCarrier(lookup, input.declaration) === selected.callableValue, true);
  assert.equal(reads, 0);
  input.current.context.records.seal();
  assert.throws(() => finalizeRustCallableSignature(lookup, input.declaration), /after analysis is sealed/u);
  assert.throws(() => resolveRustCallableSignatureCarrier(lookup, input.declaration), /after analysis is sealed/u);
  assert.equal(reads, 0);
});

test("a differing full parameter ABI cannot be hidden by a completed native signature", () => {
  const input = fixture(false);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected !== undefined, true);
  assert.throws(() => finalizeRustCallableSignature(input.current, input.declaration, {
    parameterAbis: selected.parameterAbis.map(abi => ({ ...abi, form: "optional" })),
  }), /Conflicting Rust semantic plan 'tsonic.rust.sourceParameterAbi'/u);
  assert.equal(input.admissions(), 1);
  assert.equal(input.current.context.records.sourceCallableReturn.get(input.declaration) === selected.result, true);
});

test("a complete callable keeps its selected logical contract separate from native retained storage", () => {
  const { context, walk } = analyzeRustOperations('import type { int32 } from "@tsonic/core/types.js"; export function step(callback: () => int32): () => int32 { return callback; }', { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  assert.equal(declaration !== undefined, true);
  const current = createRustCarrierProbe(walk);
  const selected = finalizeRustCallableSignature(current, declaration);
  assert.equal(selected !== undefined, true);
  assert.equal(rustTargetTypeRefEquals(selected.logicalReturn, selected.result.returnCarrier), false,
    "a selected logical annotation is not reconstructed from the normalized native fact");
  assert.equal(current.context.records.sourceCallableReturn.get(declaration) === selected.result, true);
  assert.equal(finalizeRustCallableSignature(current, declaration) === selected, true);
});

test("the cached native callable owns immutable argument containers without copying canonical input carriers", () => {
  const input = fixture(false);
  const selected = finalizeRustCallableSignature(input.current, input.declaration);
  assert.equal(selected !== undefined && selected.callableValue !== undefined, true);
  const carrier = selected.callableValue;
  assert.equal(carrier.kind, "target-named");
  const arguments_ = carrier.genericArguments;
  const parameters = arguments_[1].type;
  assert.equal(parameters.kind, "tuple");
  for (const value of [selected, selected.parameterAbis, carrier, arguments_, parameters, parameters.elements])
    assert.equal(Object.isFrozen(value), true);
  assert.equal(parameters.elements[0] === selected.parameterAbis[0].parameterCarrier, true);
  assert.throws(() => { parameters.elements.length = 0; }, TypeError);
  assert.throws(() => { carrier.genericArguments = []; }, TypeError);
  assert.equal(resolveRustCallableSignatureCarrier(input.current, input.declaration) === carrier, true);
  assert.equal(parameters.elements.length, 1);
});

for (const [name, path] of [
  ["recordFunctionSignatureFacts", "signatures"], ["recordCallableSuspensionFacts", "signatures"],
  ["recordCallableReturnFact", "signatures"], ["recordRustAsyncBodyFacts", "async-results"],
]) test(`the superseded independent ${name} entrypoint is rejected`, async () => {
  const module = new URL(`../../../dist/analysis/callables/${path}.js`, import.meta.url).href;
  const source = `import { ${name} } from ${JSON.stringify(module)};`;
  await assert.rejects(import("data:text/javascript," + encodeURIComponent(source)), /does not provide an export named/u);
});

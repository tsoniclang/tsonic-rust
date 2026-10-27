import assert from "node:assert/strict";
import test from "node:test";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { resolveRustSuspendedCallableStorage } from "../../../dist/analysis/callables/storage/suspension-storage.js";
import { finalizeRustCallableSignature } from "../../../dist/analysis/callables/calls/signature-query.js";
import { rustJsPromiseTargetType } from "../../../dist/target-model/types/carriers/promises.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function fixture(text) {
  const { context, walk } = analyzeRustOperations(text);
  const declaration = context.sourceStorage.nodes.find(node => (context.ast.is.IsArrowFunction(node) ||
    context.ast.is.IsFunctionDeclaration(node)) && context.ast.body(node) !== undefined);
  assert.equal(declaration !== undefined, true);
  const asynchronous = context.records.asyncFunction.get(declaration);
  const generator = context.records.generator.get(declaration);
  const environment = context.retainedEnvironments.environmentFor(declaration);
  const ownership = context.retainedEnvironments.inputsFor(declaration);
  const parameters = sourceCallableValueParameters(context.ast, declaration, context.source.semantics.forNode(declaration));
  assert.equal(parameters !== undefined, true, "the checked declaration owns its complete value parameter vector");
  assert.equal(parameters.length, 1, "the fixture has one original captured input");
  const inherited = createRustRecordFixture(Object.fromEntries(["asyncFunction", "generator", "retainedEnvironment"]
    .map(family => [family, { get: node => node === declaration ? undefined : context.records[family].get(node) }])), context.records);
  const current = createRustCarrierProbe({ ...walk, context: { ...context,
    records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  return { context, current, declaration, asynchronous, generator, environment, ownership, parameter: parameters[0] };
}

function assertUnpublished(input) {
  assert.equal(input.current.context.records.retainedEnvironment.get(input.declaration) === undefined, true);
  assert.equal(input.current.context.records.asyncFunction.get(input.declaration) === undefined, true);
  assert.equal(input.current.context.records.generator.get(input.declaration) === undefined, true);
}

function assertCapturedInput(input, result) {
  assert.equal(result.capturedParameters.length, 1, "one used input is captured, not an empty or duplicated frame");
  assert.equal(result.capturedParameters[0] === input.parameter, true, "the original checked parameter owns the capture");
  assert.equal(Object.isFrozen(result.capturedParameters), true, "captured input identities are immutable");
}

for (const [name, source] of [
  ["ordinary async", "export async function source(callback:()=>Promise<number>) { return await callback(); }"],
  ["async literal", "export const source = async (callback:()=>Promise<number>) => await callback();"],
  ["generator", "export function* source(callback:()=>number): Generator<number,number,number> { yield callback(); return callback(); }"],
]) test(`${name} storage selection returns exact native retention without publishing a suspension or environment`, () => {
  const input = fixture(source);
  assert.equal(input.ownership.kind, "resolved");
  assert.equal(input.ownership.ownership, "owned", "the original exported deferred callable owns its inputs");
  assert.equal(input.environment.kind, "none", "owned storage does not invent a borrowed-parameter environment lifetime");
  const result = resolveRustSuspendedCallableStorage(input.current, input.declaration,
    [input.asynchronous?.outputCarrier ?? input.generator.returnType]);
  assert.equal(result.kind, "resolved");
  assertUnpublished(input);
  assert.equal(result.retainedEnvironment === undefined, true, "owned captures do not publish a fabricated borrow lifetime");
  assert.equal(result.storage.kind, "static", "these exact inputs own closed callback storage without an authored loan");
  assertCapturedInput(input, result);
});

test("an incompatible contextual Promise cannot publish an environment and a later exact retry succeeds", () => {
  const input = fixture("export const source = async (callback:()=>Promise<number>) => await callback();");
  assert.equal(input.ownership.kind, "resolved");
  assert.equal(input.ownership.ownership, "owned");
  assert.equal(input.environment.kind, "none");
  assert.equal(input.asynchronous.kind, "js-promise");
  const future = input.asynchronous.futureCarrier;
  assert.equal(future.genericArguments.length, 1, "the JS Promise carrier has one output argument");
  const incompatible = rustJsPromiseTargetType(rustStringTargetType());
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration, { contextualResult: incompatible }).kind, "unresolved");
  assert.equal(input.current.context.diagnostics.length, 1);
  assert.equal(input.current.context.diagnostics[0].code, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED");
  assertUnpublished(input);
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration, { contextualResult: future }).kind, "complete");
  const selected = input.current.context.records.asyncFunction.get(input.declaration);
  const retained = input.current.context.records.retainedEnvironment.get(input.declaration);
  assert.equal(selected?.kind, "js-promise");
  assert.equal(rustTargetTypeRefEquals(selected.futureCarrier, future), true, "the exact retry keeps its original checked Promise output");
  assert.equal(retained === undefined, true, "a successful owned retry does not fabricate an environment");
  assert.equal(input.current.context.records.generator.get(input.declaration) === undefined, true);
  assert.equal(input.context.retainedEnvironments.suspendedParametersFor(input.declaration).length, 1);
  assert.equal(input.context.retainedEnvironments.suspendedParametersFor(input.declaration)[0] === input.parameter, true);
  assert.equal(input.current.context.diagnostics.length, 1, "the original refusal is preserved, not erased by a retry");
  assert.equal(input.current.context.diagnostics[0].code, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED");
});

const scopedSources = [
  ["ordinary async", `async function source(callback: () => Promise<number>) { return await callback(); }
export async function observe(callback: () => Promise<number>) { return await source(callback); }`],
  ["async literal", `const source = async (callback: () => Promise<number>) => await callback();
export async function observe(callback: () => Promise<number>) { return await source(callback); }`],
];

function selectedEnvironment(input) {
  assert.equal(input.ownership.kind, "resolved");
  assert.equal(input.ownership.ownership, "borrowed", "the actual private callable is immediately awaited by its checked caller");
  assert.equal(input.environment.kind, "selected", "the scoped open callback has a real named input lifetime");
  const environment = input.environment.environment;
  assert.equal(environment.lifetime.kind, "parameter");
  assert.equal(environment.inputs.length, 1);
  assert.equal(environment.inputs[0].kind, "parameter");
  assert.equal(environment.inputs[0].declaration === input.parameter, true);
  assert.equal(Object.isFrozen(environment) && Object.isFrozen(environment.inputs), true);
  return environment;
}

for (const [name, source] of scopedSources) test(`scoped ${name} storage selection keeps its exact named lifetime without publication`, () => {
  const input = fixture(source);
  const expected = selectedEnvironment(input);
  const result = resolveRustSuspendedCallableStorage(input.current, input.declaration, [input.asynchronous.outputCarrier]);
  assert.equal(result.kind, "resolved");
  assertUnpublished(input);
  assertCapturedInput(input, result);
  assert.equal(result.storage.kind, "lifetime");
  assert.equal(result.storage.lifetime.identity, expected.lifetime.identity);
  assert.equal(result.retainedEnvironment !== undefined, true);
  assert.equal(result.retainedEnvironment.lifetime.identity, expected.lifetime.identity);
  assert.equal(result.retainedEnvironment.inputs.length, expected.inputs.length);
  assert.equal(result.retainedEnvironment.inputs.every((value, index) => value.kind === "parameter" &&
    expected.inputs[index].kind === "parameter" && value.declaration === expected.inputs[index].declaration), true);
});

test("a scoped contextual Promise retry publishes only its original selected lifetime after exact admission", () => {
  const input = fixture(scopedSources[1][1]);
  const expected = selectedEnvironment(input);
  assert.equal(input.asynchronous.kind, "js-promise");
  const future = input.asynchronous.futureCarrier;
  assert.equal(future.genericArguments.length, 1, "the scoped Promise still has only its exact output argument");
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration,
    { contextualResult: rustJsPromiseTargetType(rustStringTargetType()) }).kind, "unresolved");
  assert.equal(input.current.context.diagnostics.length, 1);
  assert.equal(input.current.context.diagnostics[0].code, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED");
  assertUnpublished(input);
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration, { contextualResult: future }).kind, "complete");
  assert.equal(input.current.context.records.asyncFunction.get(input.declaration)?.kind, "js-promise");
  const retained = input.current.context.records.retainedEnvironment.get(input.declaration);
  assert.equal(retained !== undefined, true);
  assert.equal(retained.lifetime.identity, expected.lifetime.identity);
  assert.equal(retained.inputs.length, expected.inputs.length);
  assert.equal(retained.inputs.every((value, index) => value.kind === "parameter" &&
    expected.inputs[index].kind === "parameter" && value.declaration === expected.inputs[index].declaration), true);
  assert.equal(input.current.context.records.generator.get(input.declaration) === undefined, true);
  assert.equal(input.current.context.diagnostics.length, 1, "the original scoped refusal remains recorded after retry");
  assert.equal(input.current.context.diagnostics[0].code, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED");
});

test("an explicit generator input loan remains named without a generated borrowed-parameter environment", () => {
  const input = fixture(`import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function* source<Region extends Life>(value: Ref<int32, Region>): Generator<int32, int32, int32> {
  yield load(value); return load(value);
}`);
  assert.equal(input.ownership.kind, "resolved");
  assert.equal(input.ownership.ownership, "owned");
  assert.equal(input.environment.kind, "none");
  const parameter = input.context.records.sourceParameterAbi.get(input.parameter)?.parameterCarrier;
  assert.equal(parameter?.kind, "reference");
  assert.equal(parameter.lifetime.kind, "parameter");
  const result = resolveRustSuspendedCallableStorage(input.current, input.declaration, [input.generator.returnType]);
  assert.equal(result.kind, "resolved");
  assertUnpublished(input);
  assertCapturedInput(input, result);
  assert.equal(result.retainedEnvironment === undefined, true);
  assert.equal(result.storage.kind, "lifetime", "absence of a generated environment never widens the real input borrow to static");
  assert.equal(result.storage.lifetime.identity, parameter.lifetime.identity);
});

test("suspension storage refuses a sealed request before accessing caller source metadata", () => {
  const records = createRustProgramRecordBuilder();
  records.seal([]);
  let reads = 0;
  const context = { records, get ast() { reads++; throw new Error("source read after seal"); } };
  assert.throws(() => resolveRustSuspendedCallableStorage({ context }, {}, []), /after analysis is sealed/u);
  assert.equal(reads, 0);
});

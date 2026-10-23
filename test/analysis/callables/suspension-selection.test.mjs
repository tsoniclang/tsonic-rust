import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../dist/analysis/program/carrier-probe.js";
import { resolveRustSuspendedCallableStorage } from "../../../dist/analysis/callables/suspension-storage.js";
import { finalizeRustCallableSignature } from "../../../dist/analysis/callables/signature-query.js";
import { rustJsPromiseTargetType } from "../../../dist/target-model/types/carriers/promises.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";

function fixture(text) {
  const { context, walk } = analyzeRustOperations(text);
  const declaration = context.sourceStorage.nodes.find(node => (context.ast.is.IsArrowFunction(node) ||
    context.ast.is.IsFunctionDeclaration(node)) && context.ast.body(node) !== undefined);
  assert.equal(declaration !== undefined, true);
  const asynchronous = context.records.asyncFunction.get(declaration);
  const generator = context.records.generator.get(declaration);
  const environment = context.retainedEnvironments.environmentFor(declaration);
  assert.equal(environment.kind, "selected", "the actual native input has an open owned environment");
  const inherited = createRustRecordFixture(Object.fromEntries(["asyncFunction", "generator", "retainedEnvironment"]
    .map(family => [family, { get: node => node === declaration ? undefined : context.records[family].get(node) }])), context.records);
  const current = createRustCarrierProbe({ ...walk, context: { ...context,
    records: createRustProgramRecordBuilder(context.typeDefinitions, inherited) } });
  return { context, current, declaration, asynchronous, generator, environment: environment.environment };
}

for (const [name, source] of [
  ["ordinary async", "export async function source(callback:()=>Promise<number>) { return await callback(); }"],
  ["async literal", "export const source = async (callback:()=>Promise<number>) => await callback();"],
  ["generator", "export function* source(callback:()=>number): Generator<number,number,number> { yield callback(); return callback(); }"],
]) test(`${name} storage selection returns exact native retention without publishing a suspension or environment`, () => {
  const input = fixture(source);
  const result = resolveRustSuspendedCallableStorage(input.current, input.declaration,
    [input.asynchronous?.outputCarrier ?? input.generator.returnType]);
  assert.equal(result.kind, "resolved");
  assert.equal(input.current.context.records.retainedEnvironment.get(input.declaration) === undefined, true);
  assert.equal(input.current.context.records.asyncFunction.get(input.declaration) === undefined, true);
  assert.equal(input.current.context.records.generator.get(input.declaration) === undefined, true);
  assert.equal(result.retainedEnvironment !== undefined, true);
  assert.equal(result.retainedEnvironment.lifetime.identity, input.environment.lifetime.identity);
  assert.equal(result.retainedEnvironment.inputs.length, input.environment.inputs.length);
  assert.equal(result.retainedEnvironment.inputs.every((value, index) => value.kind === "parameter" && input.environment.inputs[index].kind === "parameter" && value.declaration === input.environment.inputs[index].declaration), true);
  assert.equal(result.capturedParameters.length, 1);
});

test("an incompatible contextual Promise cannot publish an environment and a later exact retry succeeds", () => {
  const input = fixture("export const source = async (callback:()=>Promise<number>) => await callback();");
  assert.equal(input.asynchronous.kind, "js-promise");
  const future = input.asynchronous.futureCarrier;
  assert.equal(future.genericArguments.length, 1, "the JS Promise carrier has one output argument");
  const incompatible = rustJsPromiseTargetType(rustStringTargetType());
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration, { contextualResult: incompatible }) === undefined, true);
  assert.equal(input.current.context.diagnostics.length, 1);
  assert.equal(input.current.context.diagnostics[0].code, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED");
  assert.equal(input.current.context.records.retainedEnvironment.get(input.declaration) === undefined, true);
  assert.equal(input.current.context.records.asyncFunction.get(input.declaration) === undefined, true);
  assert.equal(finalizeRustCallableSignature(input.current, input.declaration, { contextualResult: future }) !== undefined, true);
  const selected = input.current.context.records.asyncFunction.get(input.declaration);
  const retained = input.current.context.records.retainedEnvironment.get(input.declaration);
  assert.equal(selected?.kind, "js-promise");
  assert.equal(retained !== undefined, true);
  assert.equal(retained.lifetime.identity, input.environment.lifetime.identity);
  assert.equal(retained.inputs.every((value, index) => value.kind === "parameter" && input.environment.inputs[index].kind === "parameter" && value.declaration === input.environment.inputs[index].declaration), true);
  assert.equal(input.current.context.diagnostics.length, 1, "the original refusal is preserved, not erased by a retry");
});

test("suspension storage refuses a sealed request before accessing caller source metadata", () => {
  const records = createRustProgramRecordBuilder();
  records.seal([]);
  let reads = 0;
  const context = { records, get ast() { reads++; throw new Error("source read after seal"); } };
  assert.throws(() => resolveRustSuspendedCallableStorage({ context }, {}, []), /after analysis is sealed/u);
  assert.equal(reads, 0);
});

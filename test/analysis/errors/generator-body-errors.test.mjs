import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { selectRustProducerError } from "../../../dist/analysis/callables/calls/producer-errors.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { compileRust } from "../../helpers/rust-session.mjs";

for (const asynchronous of [false, true]) {
  test(`${asynchronous ? "async" : "sync"} generator body errors never become creation errors`, () => {
    const context = analyzeRustErrorEffects(`
class Failure extends Error { constructor(readonly code: number) { super("failure"); } }
export ${asynchronous ? "async " : ""}function* values(): ${asynchronous ? "AsyncGenerator" : "Generator"}<number, void, unknown> {
  yield 1;
  throw new Failure(7);
}`, { surfaces: [] });
    const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === "values");
    assert.equal(declaration !== undefined, true, "the original generator declaration is present");
    const producers = context.callableValues.nativeProducers;
    const input = { producers, records: context.records, definitions: context.typeDefinitions };
    const bodyReference = rustProducerErrorReference(producers.errorFor(declaration, "body"));
    assert.equal(bodyReference !== undefined, true, "the existing producer owns the generator's body channel");
    const body = selectRustProducerError(bodyReference, input);
    assert.equal(body?.kind, "region", "the closed body error comes from the original body effects");
    assert.equal(body.declaration === declaration, true, "the source generator remains the error owner");
    assert.equal(body.effects.localErrors, true, "the authored project error is retained rather than declared infallible");
    const invocationReference = rustProducerErrorReference(producers.errorFor(declaration, "invoke"));
    assert.equal(invocationReference !== undefined, true, "the existing invoke channel is independently owned");
    const invocation = selectRustProducerError(invocationReference, input);
    assert.equal(invocation?.kind === "carrier" && invocation.carrier.kind === "target-named" &&
      invocation.carrier.id === rustInfallibleTargetId, true, "creating a suspended generator cannot execute its throwing body");
  });
}

test("an ordinary synchronous function cannot fabricate a deferred body error channel", () => {
  const context = analyzeRustErrorEffects("export function ordinary(): number { return 7; }", { surfaces: [] });
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  const producers = context.callableValues.nativeProducers;
  const reference = rustProducerErrorReference(producers.errorFor(declaration, "body"));
  assert.equal(reference !== undefined, true, "the reference identifies the actual source producer");
  assert.equal(selectRustProducerError(reference, { producers, records: context.records,
    definitions: context.typeDefinitions }) === undefined, true, "only a genuine suspended body owns deferred body errors");
});

for (const [name, invocation, asynchronous] of [
  ["synchronous resume", "const iterator = values(); iterator.next();", false],
  ["synchronous iteration", "for (const value of values()) { void value; }", false],
  ["asynchronous resume", "const iterator = values(); await iterator.next();", true],
  ["asynchronous iteration", "for await (const value of values()) { void value; }", true],
]) {
  test(`${name} consumes the original generator body error instead of executing it at creation`, () => {
    const context = analyzeRustErrorEffects(`
${asynchronous ? "async " : ""}function* values(): ${asynchronous ? "AsyncGenerator" : "Generator"}<number, void, unknown> {
  yield 1;
  throw new Error("body");
}
export ${asynchronous ? "async " : ""}function consume(): ${asynchronous ? "Promise<void>" : "void"} { ${invocation} }
`, { surfaces: [] });
    const nodes = context.sourceStorage.nodes;
    const named = name => nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === name);
    const generator = named("values");
    const consumer = named("consume");
    const creation = nodes.find(node => context.ast.is.IsCallExpression(node) &&
      context.ast.text(Node_Expression(context.ast, node)) === "values");
    assert.equal(context.records.sourceCallEffects.get(creation)?.invocation, "infallible",
      "the actual generator creation does not execute the body");
    assert.equal(context.records.errorEffects.get(consumer)?.localErrors, true,
      "the actual consuming activation receives the authored body failure");
    const executed = nodes.flatMap(node => context.records.sourceErrorEffects.get(node)?.edges ?? [])
      .filter(edge => edge.declaration === generator);
    assert.equal(executed.length, 1, "one exact original body correspondence reaches the consumer");
    assert.equal(executed[0].effects.localErrors, true, "the source error is not replaced by an infallible or invented carrier");
    assert.equal(Object.isFrozen(executed[0]), true, "the body error edge is sealed data");
  });
}

test("an infallible generator resume still publishes its physical Result elimination correspondence", () => {
  const source = `function* values(): Generator<number, void, unknown> { yield 1; }
export function consume(): void { values().next(); }`;
  const context = analyzeRustErrorEffects(source, { surfaces: [] });
  const generator = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "values");
  const edges = context.sourceStorage.nodes.flatMap(node => context.records.sourceErrorEffects.get(node)?.edges ?? [])
    .filter(edge => edge.declaration === generator);
  assert.equal(edges.length, 1, "the required physical Result path is present even without an inhabited error");
  assert.equal(edges[0].effects.localErrors, false, "the native body remains actually infallible");
  assert.equal(edges[0].effects.nativeErrors.length, 0, "no default runtime error channel is added");
  for (const surfaces of [[], ["js"]]) {
    const { result } = compileRust({ surfaces, files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0, "the exact pure generator result is admitted without a fallible caller");
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))
      .map(artifact => artifact.text).join("\n");
    assert.match(output, /\.resume\(/u, "the physical native generator resume is retained");
    assert.match(output, /Err\([^)]*\)\s*=>\s*match/u,
      "the actual Result ABI is eliminated by exhaustive matching, not erased");
  }
});

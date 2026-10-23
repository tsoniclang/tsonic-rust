import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { selectRustProducerError } from "../../../dist/analysis/callables/producer-errors.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";

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

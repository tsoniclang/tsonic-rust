import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { createRustNativeOutwardResults } from "../../../dist/analysis/callables/native-outward-results.js";
import { rustAsyncFunctionFactKey, rustErrorEffectsFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";

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

test("JS outward results retain exact Promise error and lifetime independently of native output normalization", () => {
  const current = fixture(`export async function pure(): Promise<string> { return "value"; }`, ["js"]);
  const declaration = current.declaration("pure");
  const asynchronous = current.context.facts.get(declaration, rustAsyncFunctionFactKey);
  const value = current.producers.invocationResultFor(declaration);
  assert.equal(value?.id, "rust.js.JsPromise");
  assert.deepEqual(value.genericArguments[0], asynchronous.futureCarrier.genericArguments[0]);
  assert.equal(rustTargetTypeRefEquals(value.genericArguments[1].type, current.producers.outwardReturnFor(declaration)), true);
  const error = rustProducerErrorReference(value.genericArguments[2].type);
  assert.equal(error?.channel, 0);
  assert.equal(current.producers.forIdentity(error.identity)?.declaration === declaration, true);
});

test("outward carrier queries fail closed before finalized native effects and do not cache that incomplete phase", () => {
  const current = fixture(`export async function pure(): Promise<string> { return "value"; }`);
  const declaration = current.declaration("pure");
  const facts = current.context.facts;
  let finalized = false;
  const selected = createRustNativeOutwardResults({
    facts: { getFact(node, key) { return !finalized && key === rustErrorEffectsFactKey ? undefined : facts.getFact(node, key); } },
    definitions: current.context.typeDefinitions, producers: current.producers,
    returnCarrierFor(node) {
      const result = current.context.callableValues.nativeStorage.returnFor(node);
      return result.kind === "unresolved" ? undefined : result.carrier;
    },
  });
  assert.equal(selected.invocationFor(declaration) === undefined, true, "unknown fallibility cannot become pure output");
  assert.equal(selected.returnFor(declaration) !== undefined, true, "body storage is independent of final error effects");
  finalized = true;
  assert.equal(rustTargetTypeRefEquals(selected.invocationFor(declaration), current.producers.invocationResultFor(declaration)), true);
});

test("outward result recursion is bounded at the producer owner", () => {
  const current = fixture(`export function pure(): string { return "value"; }`);
  const declaration = current.declaration("pure");
  const selected = createRustNativeOutwardResults({ facts: current.context.facts,
    definitions: current.context.typeDefinitions, producers: current.producers,
    returnCarrierFor(node) { return selected.returnFor(node); },
  });
  assert.equal(selected.returnFor(declaration) === undefined, true, "recursive result selection fails closed");
});

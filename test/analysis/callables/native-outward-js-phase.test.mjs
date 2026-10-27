import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { createRustNativeOutwardResults } from "../../../dist/analysis/callables/native/native-outward-results.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";

import { rustErrorEffectsAreFallible } from "../../../dist/analysis/errors/error-effects.js";

test("synchronous JS Future output preserves producer error identity before deferred-effect selection", () => {
  const context = analyzeRustErrorEffects(`
    export async function pure(): Promise<string> { return "value"; }
    export async function failed(): Promise<string> { throw "failure"; }
    export function forwardPure(): Promise<string> { return pure(); }
    export function forwardFailure(): Promise<string> { return failed(); }
  `);
  const producers = context.callableValues.nativeProducers;
  const selected = createRustNativeOutwardResults({ records: context.records,
    definitions: context.typeDefinitions, producers: {
      forDeclaration: producers.forDeclaration, errorFor: producers.errorFor,
      deferredFor() { throw new Error("JS output shape cannot depend on unfinished deferred-effect selection"); },
    }, returnCarrierFor(node) {
      const result = context.callableValues.nativeStorage.prepareReturn(node);
      return result.kind === "unresolved" ? undefined : result.carrier;
    },
  });
  for (const [forward, origin] of [["forwardPure", "pure"], ["forwardFailure", "failed"]]) {
    const declaration = name => producers.producers.find(producer => context.ast.name(producer.declaration) !== undefined &&
      context.ast.text(context.ast.name(producer.declaration)) === name)?.declaration;
    const owner = declaration(forward);
    const carrier = selected.invocationFor(owner);
    assert.equal(carrier?.id, "rust.js.JsPromise", forward);
    assert.equal(Object.isFrozen(carrier), true, forward);
    assert.equal(carrier.genericArguments.length, 1, "the actual JS Promise stores only its output, not a producer error parameter");
    const error = rustProducerErrorReference(producers.errorFor(owner, 0));
    assert.equal(error?.channel, 0, forward);
    assert.equal(producers.forIdentity(error.identity)?.declaration === owner, true, forward);
    const deferred = producers.deferredErrorFor(owner, error.channel);
    const effects = context.records.errorEffects.get(declaration(origin));
    assert.equal(deferred !== undefined && effects !== undefined, true, "final channel proof remains required");
    assert.equal(deferred.kind === "target-named" && deferred.id === "rust.core.Infallible",
      !rustErrorEffectsAreFallible(effects), "transport retains actual producer fallibility");
  }
});

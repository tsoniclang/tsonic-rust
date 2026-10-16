import assert from "node:assert/strict";
import test from "node:test";
import { rustFutureValueForOperation } from "../../../dist/analysis/callables/future-values.js";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { rustJsPromiseTargetType, rustSourcePrimitiveTargetType, rustJsValueTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("source JS calls use their Promise rejection channel rather than body-local fallibility", () => {
  const promise = rustJsPromiseTargetType(rustSourcePrimitiveTargetType("uint64"));
  for (const awaiting of ["infallible", "fallible"]) {
    const selected = rustFutureValueForOperation({ kind: "source-call", resultCarrier: promise },
      { invocation: "infallible", awaiting });
    assert.equal(selected !== undefined, true, awaiting);
    assert.equal(selected.awaiting, "fallible", awaiting);
    assert.equal(selected.errorBoundary, "js-rejection", awaiting);
    assert.equal(Object.hasOwn(selected, "errorCarrier"), false, awaiting);
  }
});

test("multiple JS await producers contribute one uniform rejection effect", () => {
  const context = analyzeRustErrorEffects(`
    async function first(): Promise<number> { return 1; }
    async function second(): Promise<string> { return "two"; }
    export async function both(): Promise<number> {
      const one = await first();
      const two = await second();
      return one + two.length;
    }
  `);
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "both");
  assert.equal(declaration !== undefined, true);
  const effects = context.records.errorEffects.get(declaration);
  assert.equal(effects !== undefined, true);
  assert.equal(effects.localErrors, false);
  assert.equal(effects.nativeErrors.length, 1);
  assert.equal(effects.nativeErrors[0].identity, "js-rejection");
  assert.equal(rustTargetTypeRefEquals(effects.nativeErrors[0].errorType, rustJsValueTargetType()), true);
});

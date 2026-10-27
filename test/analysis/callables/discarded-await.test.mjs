import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustDiscardedAwaitSelection, rustAwaitValueMatchesCarrier } from "../../../dist/analysis/callables/async/await-values.js";
import { rustFutureTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const output = rustSourcePrimitiveTargetType("int32");
const future = rustFutureTargetType(output);
const effect = Object.freeze({ outputCarrier: output, awaiting: "infallible", errorBoundary: "none",
  awaitedConversion: Object.freeze({ kind: "identity", sourceCarrier: output, targetCarrier: output, fallible: false }) });

test("native discard preserves every heterogeneous completion without a fabricated success carrier", () => {
  const otherOutput = rustSourcePrimitiveTargetType("bool");
  const otherFuture = rustFutureTargetType(otherOutput);
  const otherEffect = Object.freeze({ outputCarrier: otherOutput, awaiting: "infallible", errorBoundary: "none",
    awaitedConversion: Object.freeze({ kind: "identity", sourceCarrier: otherOutput, targetCarrier: otherOutput, fallible: false }) });
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Pending");
  const definitions = { ...emptyRustTypeDefinitions, sourceUnionVariants: selected =>
    rustTargetTypeRefEquals(selected, carrier) ? [{ name: "Integer", carrier: future }, { name: "Boolean", carrier: otherFuture }] : undefined };
  const selected = finalizeRustDiscardedAwaitSelection(carrier,
    value => rustTargetTypeRefEquals(value, future) ? effect : rustTargetTypeRefEquals(value, otherFuture) ? otherEffect : undefined,
    definitions);
  assert.equal(selected?.kind, "union", "the original checked branch topology is retained");
  assert.equal(selected.alternatives.length, 2, "both distinct native success types are admitted");
  for (const [index, alternative] of selected.alternatives.entries()) {
    assert.equal(alternative.selection.value.completion.kind, "discard", "only the success value is discarded");
    assert.equal(rustTargetTypeRefEquals(alternative.selection.value.future.outputCarrier,
      index === 0 ? output : otherOutput), true, "each branch retains its own native output and effects");
  }
  assert.equal("resultCarrier" in selected, false, "discard introduces no success join or unit carrier claim");
});

test("native discard refuses missing or mismatched future evidence", () => {
  assert.equal(finalizeRustDiscardedAwaitSelection(future, () => undefined) === undefined, true,
    "a future cannot be discarded without its exact error and completion evidence");
  const wrong = rustSourcePrimitiveTargetType("bool");
  assert.equal(finalizeRustDiscardedAwaitSelection(future, () => ({ ...effect, outputCarrier: wrong })) === undefined, true,
    "a different native completion cannot be substituted for the original future");
});

test("a discard-only selection cannot satisfy the valued-await contract", () => {
  const selection = finalizeRustDiscardedAwaitSelection(future, () => effect);
  assert.equal(selection !== undefined, true, "the exact discarded future is admitted");
  assert.equal(rustAwaitValueMatchesCarrier({ operandCarrier: future, resultCarrier: output, selection }, future, output), false,
    "ordinary await still requires its selected value conversion rather than a discarded result");
});

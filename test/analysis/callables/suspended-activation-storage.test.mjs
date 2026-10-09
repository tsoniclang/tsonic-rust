import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { suspendedActivationCallableSource } from "../../../../tsonic/test/fixtures/suspended-activation-callables.mjs";
import { rustAsyncFunctionFactKey, rustSourceCallableReturnFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustCallableInvocationResult } from "../../../dist/analysis/facts/callable-results.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("suspended recursive entries prove the actual activation storage without reentering internal signatures", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": suspendedActivationCallableSource } });
  const { ast } = program.source;
  const activations = program.callableOwnership.activations;
  assert.equal(activations.length, 1, "the source has one exact shared owning activation");
  const [activation] = activations;
  assert.equal(activation.callableDeclarations.length, 2);
  assert.deepEqual([...new Set(activation.externalCaptures.map(capture => ast.text(ast.name(capture.declaration))))], ["total"]);
  assert.deepEqual(activation.slotDeclarations.map(declaration => ast.text(ast.name(declaration))).sort(), ["advance", "finish"]);
  for (const declaration of activation.callableDeclarations) {
    const suspension = program.facts.getFact(declaration, rustAsyncFunctionFactKey);
    const body = program.facts.getFact(declaration, rustSourceCallableReturnFactKey);
    assert.equal(suspension?.kind, "js-promise", "an entry has a completed suspension protocol");
    assert.equal(suspension.storage.kind, "static", "the proven activation owns only native integer storage");
    assert.equal(rustTargetTypeRefEquals(body?.returnCarrier, rustSourcePrimitiveTargetType("int32")), true,
      "the body return is the exact integer, never its Promise invocation carrier");
    assert.equal(rustTargetTypeRefEquals(rustCallableInvocationResult(program.facts, declaration), suspension.futureCarrier), true,
      "the invocation and body protocols remain distinct");
  }
  const frames = program.callableValues.frames;
  assert.equal(frames.issues.length, 0, "every physical activation entry is finalized");
  assert.equal(frames.definitions.length, 1);
  assert.equal(frames.definitions[0].activation === activation, true, "suspension and lowering share one ownership model");
});

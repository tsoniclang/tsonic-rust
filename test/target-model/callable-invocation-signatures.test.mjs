import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableInvocationSignaturesMatch } from "../../dist/policy/conversions/callable-input.js";
import { rustCallableTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { rustJsPromiseTargetType } from "../../dist/target-model/types/carriers/promises.js";
import { rustCallableSignatureBinding } from "../../dist/target-model/types/carriers/callable-signatures.js";
import { rustFrameCallableEnvironmentBindings } from "../../dist/analysis/callables/values/frame-values.js";

const integer = { kind: "source-primitive", name: "int64" };
const number = { kind: "source-primitive", name: "float64" };
const retainedLifetime = { kind: "parameter", identity: "retained:owner", name: "owner" };

test("frame errors substitute their original definition binder rather than normalized signature placeholders", () => {
  const original = { kind: "type-parameter", identity: "source:owner:Value", name: "Value" };
  const signature = rustCallableSignatureBinding([], [original], original);
  assert.equal(signature !== undefined, true, "the original signature has one canonical normalized environment");
  assert.equal(signature.signature.environmentParameters[0].identity === original.identity, false,
    "raw protocol normalization does not rename the original definition binder");
  const definition = { environmentParameters: [original] };
  const bindings = rustFrameCallableEnvironmentBindings(definition, { environmentIndexes: [0] }, [integer]);
  assert.equal(bindings?.get(original.identity) === integer, true, "the physical error binds the actual definition parameter");
  assert.equal(bindings?.has(signature.signature.environmentParameters[0].identity), false,
    "the normalized placeholder is not evidence for an authored error parameter");
  assert.equal(rustFrameCallableEnvironmentBindings(definition, { environmentIndexes: [1] }, [integer]) === undefined, true,
    "a foreign frame index cannot supply a native binding");
  assert.equal(rustFrameCallableEnvironmentBindings(definition, { environmentIndexes: [0] }, []) === undefined, true,
    "a missing actual native environment remains invalid");
  assert.equal(rustFrameCallableEnvironmentBindings(definition, { environmentIndexes: [0, 0] }, [integer, number]) === undefined, true,
    "one original parameter cannot receive contradictory actual native arguments");
});

test("native invocation correspondence keeps storage environments separate from exact signatures", () => {
  const promise = rustJsPromiseTargetType(integer);
  const formal = rustCallableTargetType([integer], promise, retainedLifetime);
  const narrowed = rustCallableTargetType([integer], promise);
  assert.equal(rustCallableInvocationSignaturesMatch(formal, narrowed), true);
  assert.equal(rustCallableInvocationSignaturesMatch(narrowed, formal), true);
  for (const changed of [
    rustCallableTargetType([number], promise),
    rustCallableTargetType([], promise),
    rustCallableTargetType([integer], rustJsPromiseTargetType(number)),
    rustCallableTargetType([integer], rustJsPromiseTargetType({ kind: "reference", mutable: false, referent: integer,
      lifetime: retainedLifetime })),
    { kind: "reference", mutable: false, referent: narrowed },
    { kind: "source-primitive", name: "bool" },
  ]) assert.equal(rustCallableInvocationSignaturesMatch(formal, changed), false,
    "native width, result payload lifetime, reference and callable identity remain exact");
});

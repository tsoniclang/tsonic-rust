import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableInvocationSignaturesMatch } from "../../dist/policy/conversions/callable-input.js";
import { rustCallableTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { rustJsPromiseTargetType } from "../../dist/target-model/types/carriers/promises.js";

const integer = { kind: "source-primitive", name: "int64" };
const number = { kind: "source-primitive", name: "float64" };
const retainedLifetime = { kind: "parameter", identity: "retained:owner", name: "owner" };

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

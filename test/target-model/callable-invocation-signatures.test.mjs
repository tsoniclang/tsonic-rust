import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableInvocationSignaturesMatch } from "../../dist/target-model/conversions/callable-input.js";
import { rustCallableTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { rustJsPromiseTargetTypeWithLifetime } from "../../dist/target-model/types/carriers/js.js";

const integer = { kind: "source-primitive", name: "int64" };
const number = { kind: "source-primitive", name: "float64" };
const staticLifetime = { kind: "static" };
const retainedLifetime = { kind: "parameter", identity: "retained:owner", name: "owner" };

test("native invocation correspondence keeps storage environments separate from exact signatures", () => {
  const promise = rustJsPromiseTargetTypeWithLifetime(integer, staticLifetime);
  const formal = rustCallableTargetType([integer], promise, retainedLifetime);
  const narrowed = rustCallableTargetType([integer], promise);
  assert.equal(rustCallableInvocationSignaturesMatch(formal, narrowed), true);
  assert.equal(rustCallableInvocationSignaturesMatch(narrowed, formal), true);
  for (const changed of [
    rustCallableTargetType([number], promise),
    rustCallableTargetType([], promise),
    rustCallableTargetType([integer], rustJsPromiseTargetTypeWithLifetime(number, staticLifetime)),
    rustCallableTargetType([integer], rustJsPromiseTargetTypeWithLifetime(integer, retainedLifetime)),
    { kind: "reference", mutable: false, referent: narrowed },
    { kind: "source-primitive", name: "bool" },
  ]) assert.equal(rustCallableInvocationSignaturesMatch(formal, changed), false,
    "native width, result lifetime, reference and callable identity remain exact");
});

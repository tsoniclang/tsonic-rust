import assert from "node:assert/strict";
import test from "node:test";
import { rustNativeFutureType } from "../../../../dist/backend/planner/types/native-futures.js";
import { printRustType } from "../../../../dist/print/source/types.js";

const output = { kind: "named", path: "Result", genericArguments: [
  { kind: "type", type: { kind: "reference", referent: { kind: "str" }, mutable: false,
    lifetime: { kind: "named", name: "input" } } },
  { kind: "type", type: { kind: "qualified", owner: { kind: "named", path: "Callback" },
    trait: { kind: "named", path: "Invocation" }, member: "AwaitError" } },
] };

test("native future construction retains the exact output and associated error type", () => {
  const future = rustNativeFutureType(output, { kind: "opaque" });
  assert.equal(future.kind, "impl-trait");
  assert.equal(future.bounds[0].reference.trait.genericArguments[0].type === output, true);
  assert.equal(Object.hasOwn(future, "captures"), false);
  assert.equal(printRustType(future), "impl core::future::Future<Output = Result<&'input str, <Callback as Invocation>::AwaitError>>");
});

test("native future capture syntax distinguishes implicit, empty and exact type/lifetime captures", () => {
  const captures = [{ kind: "lifetime", lifetime: { kind: "named", name: "input" } },
    { kind: "type", type: { kind: "named", path: "Callback" } }];
  const empty = rustNativeFutureType({ kind: "unit" }, { kind: "opaque", captures: [] });
  const exact = rustNativeFutureType({ kind: "unit" }, { kind: "opaque", captures });
  assert.equal(printRustType(empty), "impl core::future::Future<Output = ()> + use<>");
  assert.equal(printRustType(exact), "impl core::future::Future<Output = ()> + use<'input, Callback>");
  assert.equal(exact.captures === captures, true);
});

test("an immediate native completion uses its exact nameable Ready output without opaque captures", () => {
  const ready = rustNativeFutureType(output, { kind: "ready" });
  assert.equal(ready.kind, "named");
  assert.equal(ready.genericArguments[0].type === output, true);
  assert.equal(printRustType(ready), "core::future::Ready<Result<&'input str, <Callback as Invocation>::AwaitError>>");
});

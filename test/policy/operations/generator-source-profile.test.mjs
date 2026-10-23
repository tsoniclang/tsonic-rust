import assert from "node:assert/strict";
import test from "node:test";
import { rustGeneratorSourceInvocationKind, selectRustGeneratorSourceCall } from "../../../dist/policy/operations/source-profiles/generator-source-profile.js";

test("only the six registered generator body invocations carry native resume effects", () => {
  for (const kind of ["sync", "async"]) {
    for (const suffix of [`next.${kind}.0`, `next.${kind}.1`, `return.${kind}`]) {
      const identity = `tsonic.rust.generator.${suffix}`;
      assert.equal(rustGeneratorSourceInvocationKind(identity), kind, identity);
    }
  }
  for (const identity of [
    "tsonic.rust.generator.throw.sync", "tsonic.rust.generator.throw.async",
    "tsonic.rust.generator.next.sync.2", "tsonic.rust.generator.return.async.extra",
    "foreign.generator.next.sync.0", "next", "resume",
  ]) {
    assert.equal(rustGeneratorSourceInvocationKind(identity), undefined, identity);
  }
});

test("source throw-in refuses exact generator owners rather than matching a user method name", () => {
  const request = { memberName: "throw", selectedParameterCount: 1, argumentCarriers: [] };
  for (const ownerName of ["Generator", "AsyncGenerator"]) {
    const selection = selectRustGeneratorSourceCall({ ...request, ownerName });
    assert.equal(selection.kind, "rejected", ownerName);
    assert.equal(selection.code, "TSONIC_GENERATOR_THROW_UNSUPPORTED", ownerName);
    assert.equal(selection.message, "Generator throw-in is not supported.", ownerName);
  }
  assert.equal(selectRustGeneratorSourceCall({ ...request, ownerName: "AuthoredIterator" }).kind, "not-applicable",
    "an authored throw method is not the builtin source capability");
});

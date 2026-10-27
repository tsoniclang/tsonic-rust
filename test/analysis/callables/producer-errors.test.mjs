import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { selectRustProducerError } from "../../../dist/analysis/callables/calls/producer-errors.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";

function fixture(surfaces = []) {
  const context = analyzeRustErrorEffects(`
    export async function pure(): Promise<string> { return "value"; }
    export async function failed(): Promise<string> { throw "failure"; }
    export function forward(): Promise<string> { return failed(); }
    export function invoke(callback: () => string): string { return callback(); }
  `, { surfaces });
  const producers = context.callableValues.nativeProducers;
  const producer = name => producers.producers.find(candidate => {
    const selected = context.ast.name(candidate.declaration);
    return selected !== undefined && context.ast.text(selected) === name;
  });
  const input = { producers, records: context.records, definitions: context.typeDefinitions };
  const reference = (name, channel) => rustProducerErrorReference(producers.errorFor(producer(name).declaration, channel));
  return { context, input, producer, reference };
}

test("producer error selection uses the actual declaration and distinct invocation/completion channels", () => {
  const current = fixture();
  for (const name of ["pure", "failed"]) {
    const invocation = selectRustProducerError(current.reference(name, "invoke"), current.input);
    assert.equal(invocation.kind, "carrier");
    assert.equal(invocation.carrier.id, "rust.core.Infallible");
    const completion = selectRustProducerError(current.reference(name, 0), current.input);
    assert.equal(completion.kind, "region");
    assert.equal(completion.declaration === current.producer(name).declaration, true, "producer-owned region");
    assert.equal(completion.effects.localErrors, name === "failed");
    assert.equal(Object.isFrozen(completion) && Object.isFrozen(completion.effects) &&
      Object.isFrozen(completion.effects.nativeErrors), true);
  }
  const forwarded = selectRustProducerError(current.reference("forward", 0), current.input);
  assert.equal(forwarded.kind, "carrier");
  assert.equal(rustTargetTypeRefEquals(forwarded.carrier,
    current.input.producers.deferredErrorFor(current.producer("forward").declaration, 0)), true,
  "synchronous forwarding reuses the exact deferred channel owner");
});

test("JS Promise producer completions expose one rejection value independent of body errors", () => {
  const current = fixture(["js"]);
  for (const name of ["pure", "failed", "forward"]) {
    const completion = selectRustProducerError(current.reference(name, 0), current.input);
    assert.equal(completion?.kind, "carrier", name);
    assert.equal(rustTargetTypeRefEquals(completion.carrier, rustJsValueTargetType()), true, name);
    const invocation = selectRustProducerError(current.reference(name, "invoke"), current.input);
    if (name !== "forward") assert.equal(invocation.carrier.id, "rust.core.Infallible", name);
  }
});

test("a native async body keeps its exact region independently of its JS object rejection", () => {
  for (const surfaces of [[], ["js"]]) {
    const current = fixture(surfaces);
    for (const name of ["pure", "failed"]) {
      const body = selectRustProducerError(current.reference(name, "body"), current.input);
      assert.equal(body?.kind, "region", `${surfaces[0] ?? "native"}:${name}`);
      assert.equal(body.declaration === current.producer(name).declaration, true, name);
      assert.equal(body.effects.localErrors, name === "failed", name);
      assert.equal(Object.isFrozen(body) && Object.isFrozen(body.effects), true, name);
    }
    assert.equal(selectRustProducerError(current.reference("forward", "body"), current.input) === undefined, true,
      "a synchronous Promise forwarder is not a native async body");
  }
});

test("producer error selection substitutes the exact captured native implementation rather than its signature", () => {
  const current = fixture();
  const reference = current.reference("invoke", "invoke");
  assert.equal(reference.genericArguments.length, 1);
  const native = current.context.callableValues.native.inputs.find(input => input.owner === current.producer("invoke").declaration);
  const replacement = { kind: "type-parameter", identity: "caller:implementation", name: "Implementation" };
  const selected = selectRustProducerError({ ...reference, genericArguments: [{ kind: "type", type: replacement }] }, current.input);
  assert.equal(selected.kind, "region");
  assert.equal(selected.effects.nativeErrors.length, 1);
  assert.equal(rustTargetTypeRefEquals(selected.effects.nativeErrors[0].errorType.owner, replacement), true);
  assert.equal(native.implementation.identity !== replacement.identity, true, "substitution is physical, not signature identity");
});

test("producer error selection rejects foreign owners, missing evidence and malformed channels without getter execution", () => {
  const current = fixture();
  const reference = current.reference("invoke", "invoke");
  for (const changed of [{ identity: "foreign" }, { fileName: "/foreign.ts" }, { channel: 0 },
    { channel: -1 }, { channel: Infinity }, { genericArguments: [] },
    { genericArguments: [{ kind: "const", value: { kind: "integer", value: "2" } }] }]) {
    assert.equal(selectRustProducerError({ ...reference, ...changed }, current.input) === undefined, true,
      "unproved producer channels cannot default to pure or ambient errors");
  }
  const missing = { ...current.input, records: createRustRecordFixture({
errorEffects: { get: (node) => undefined }}, current.input.records) };
  assert.equal(selectRustProducerError(reference, missing) === undefined, true, "unsealed effects stay unresolved");
  let reads = 0;
  const changed = { ...reference };
  Object.defineProperty(changed, "identity", { enumerable: true, get() { reads++; return reference.identity; } });
  assert.equal(selectRustProducerError(changed, current.input) === undefined, true);
  assert.equal(reads, 0);
});

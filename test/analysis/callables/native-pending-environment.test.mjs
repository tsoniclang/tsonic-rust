import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNativePendingEnvironment } from "../../../dist/analysis/callables/retained-environments.js";
import { rustNativeFutureOutputType } from "../../../dist/target-model/types/callable-completions.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function fixture() {
  const call = Object.freeze({});
  const declaration = Object.freeze({});
  const parameter = Object.freeze({});
  const subject = Object.freeze({ kind: "value", node: call, projection: Object.freeze([]) });
  const formal = Object.freeze({ kind: "input", node: parameter, projection: Object.freeze([]) });
  const carrier = rustNativeFutureOutputType({ identity: "pending-test:body", output: rustSourcePrimitiveTargetType("int32"), captures: [] });
  const types = new Map();
  const bound = { kind: "resolved", targetBindings: { types, lifetimes: new Map(), consts: new Map() }, storageBindings: Object.freeze({}) };
  const header = { bindings: { types: new Map(), lifetimes: new Map(), consts: new Map() }, captureArguments: [] };
  const slots = [];
  const retained = [];
  let headerReads = 0;
  const operation = { kind: "source-call", asyncBody: { declaration }, targetGenericArguments: [] };
  const input = {
    source: { ast: { kindName: () => "KindCallExpression", parent: () => undefined } },
    storage: { subject(node, kind) {
      assert.equal(node === parameter && kind === "input", true, "the selected slot requests its exact original formal");
      return { kind: "resolved", subject: formal };
    }, subjectFor() { assert.fail("a source-only native entry has no invented capture reference"); } },
    records: { targetOperation: { get: node => node === call ? operation : undefined } },
    nativeStorage: { boundInvocationFor(owner, invocation, bindings) {
      assert.equal(owner === declaration && invocation === call && bindings === callerBindings, true,
        "the original selected body and invocation share the exact caller binding domain");
      return bound;
    }, genericBindingsFor() { assert.fail("a module invocation has no invented enclosing callable"); } },
    producers: { bodyResultFor: owner => owner === declaration ? carrier : undefined },
    specializations: { requiresSpecialization: () => false },
    headers: { nativeBody(owner, variant) {
      headerReads++;
      assert.equal(owner === declaration && variant === undefined, true, "the native body selects its original nonspecialized header facet");
      return { kind: "resolved", entry: { slots }, header };
    } },
    step: () => true,
    retainDataFor(value, bindings, selected) {
      retained.push({ value, bindings, carrier: selected });
      return selected;
    },
  };
  const callerBindings = Object.freeze({});
  return { input, call, declaration, parameter, subject, formal, carrier, bound, header, slots, retained, types,
    callerBindings, operation, headerReads: () => headerReads,
    select: () => selectRustNativePendingEnvironment(input, subject, callerBindings, carrier) };
}

test("native pending data proof retains original input storage and unused native header captures", () => {
  const value = fixture();
  const input = rustSourcePrimitiveTargetType("int32");
  const phantom = Object.freeze({ kind: "type-parameter", identity: "phantom", name: "Phantom" });
  const lifetime = Object.freeze({ kind: "parameter", identity: "pending-life", name: "pending" });
  value.slots.push({ kind: "source", declaration: value.parameter, carrier: input });
  value.header.captureArguments.push({ kind: "type", type: phantom }, { kind: "lifetime", lifetime });
  const selected = value.select();
  assert.equal(selected.kind, "tuple", "the source-aware proof is completed data, not Future output metadata");
  assert.equal(value.retained.length, 1, "every actual input is retained exactly once");
  assert.equal(value.retained[0].value === value.formal && value.retained[0].bindings === value.bound.storageBindings, true,
    "the original checked formal is interpreted in its exact invocation activation");
  assert.equal(rustTargetTypeRefEquals(selected.elements[0], input), true, "the native incoming carrier is preserved");
  assert.equal(selected.elements.some(element => element.kind === "type-parameter" && element.identity === phantom.identity), true,
    "an unused native type capture remains a real retention obligation");
  assert.equal(selected.elements.some(element => element.kind === "reference" && element.lifetime.identity === lifetime.identity), true,
    "the exact named native capture lifetime is retained without static substitution");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.elements), true, "the completed proof is immutable");
});

test("native pending data proof composes selected header bindings before actual invocation arguments", () => {
  const value = fixture();
  const source = Object.freeze({ kind: "type-parameter", identity: "source", name: "Source" });
  const environment = Object.freeze({ kind: "type-parameter", identity: "environment", name: "Environment" });
  const actual = rustSourcePrimitiveTargetType("int64");
  value.header.bindings.types.set(source.identity, environment);
  value.types.set(environment.identity, actual);
  value.slots.push({ kind: "source", declaration: value.parameter, carrier: source });
  value.header.captureArguments.push({ kind: "type", type: source });
  const selected = value.select();
  assert.equal(selected.kind, "tuple", "the exact selected native binding composition is completed");
  assert.equal(selected.elements.length, 2, "the input and native header remain distinct obligations");
  assert.equal(selected.elements.every(element => rustTargetTypeRefEquals(element, actual)), true,
    "neither a source binder nor its emitted environment binder is left as the physical invocation argument");
});

test("native pending data proof preserves borrowed formal carriers without manufacturing static ownership", () => {
  const value = fixture();
  const lifetime = Object.freeze({ kind: "parameter", identity: "borrowed", name: "borrowed" });
  const borrowed = Object.freeze({ kind: "reference", mutable: false, lifetime, referent: rustSourcePrimitiveTargetType("int32") });
  value.slots.push({ kind: "source", declaration: value.parameter, carrier: borrowed });
  const selected = value.select();
  assert.equal(selected.kind === "tuple" && selected.elements.length === 1, true, "the actual borrowed input remains an obligation");
  assert.equal(rustTargetTypeRefEquals(selected.elements[0], borrowed), true, "the source reference lifetime and payload remain exact");
});

test("native pending data proof refuses missing receiver duration instead of treating a module carrier as static", () => {
  for (const slot of [{ kind: "method-receiver", passing: "ref" }, { kind: "structural-receiver", passing: "shared" },
    { kind: "class-environment" }]) {
    const value = fixture();
    value.slots.push({ ...slot, carrier: rustSourcePrimitiveTargetType("int32") });
    const selected = value.select();
    assert.equal(selected.kind === "unresolved" && /source borrow-duration proof/u.test(selected.reason), true,
      "a physical native receiver requires its actual borrow-duration evidence, not source-region speculation");
  }
});

test("native pending data proof refuses contradictory physical results before selecting a header", () => {
  const value = fixture();
  value.input.producers.bodyResultFor = () => rustSourcePrimitiveTargetType("int32");
  const selected = value.select();
  assert.equal(selected.kind === "unresolved" && /identical bound physical body result/u.test(selected.reason), true,
    "the supplied carrier cannot replace the exact native body result");
  assert.equal(value.headerReads(), 0, "a contradictory result cannot trigger another header selection");
});

test("native pending data proof preserves unavailable headers and finite shared work failures", () => {
  const value = fixture();
  const missing = Object.freeze({ kind: "unresolved", at: value.call, reason: "original generic requirements are unavailable" });
  value.input.headers = missing;
  assert.equal(value.select() === missing, true, "the original missing prerequisite is not replaced by a guessed header");
  value.input.step = () => false;
  const selected = value.select();
  assert.equal(selected.kind === "unresolved" && /shared retained-data work budget/u.test(selected.reason), true,
    "the source-aware proof shares the caller's bounded work authority");
});

test("native pending data proof never treats a callable signature or ordinary result as stored Future evidence", () => {
  const value = fixture();
  const signature = { kind: "input", node: value.call, projection: [] };
  assert.equal(selectRustNativePendingEnvironment(value.input, signature, value.callerBindings, value.carrier), undefined,
    "an input signature is not the checked native invocation that constructs pending data");
  value.operation.asyncBody = undefined;
  assert.equal(value.select(), undefined, "ordinary calls remain with their existing retained-storage owner");
  assert.equal(value.headerReads(), 0, "neither inverse requests a native Future header");
});

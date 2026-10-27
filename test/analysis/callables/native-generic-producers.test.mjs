import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { createRustNativeGenericProducerPlan, prepareRustNativeGenericProducerRequests }
  from "../../../dist/analysis/callables/native/native-generic-producers.js";

const producerPlan = options => createRustNativeGenericProducerPlan({ ...options,
  requests: prepareRustNativeGenericProducerRequests(options) });

function fixture(text, configuration = {}) {
  const program = analyzeRustErrorEffects(text, { surfaces: [], ...configuration });
  const source = program.source;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  const { native, nativeStorage, generic } = program.callableValues;
  const plan = program.callableValues.selected.nativeGenericProducers;
  const options = { ast: source.ast, records: program.records, nodes, generic, native, nativeStorage,
    definitions: program.typeDefinitions };
  const declaration = name => nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
    source.ast.name(node) !== undefined && source.ast.text(source.ast.name(node)) === name);
  return { program, source, native, options, plan, declaration };
}

test("generic native producers enumerate exact existing families through aliases and returned values", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    function make(): Identity {
      const original = <Value>(value: Value): Value => value;
      const alias: Identity = original; return alias;
    }
    function invoke(callback: Identity): number { return callback<number>(7); }
    export function main(): number { const selected = make(); return invoke(selected); }
  `);
  const protocol = current.native.inputsFor(current.declaration("invoke"))[0].protocol;
  const selected = current.plan.forProtocol(protocol);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].definition.familyIdentity === current.program.callableValues.generic.definitions[0].identity, true);
  assert.equal(current.program.callableValues.generic.physical.definitionFor(selected[0].definition.carrier) === selected[0].definition, true);
  assert.equal(selected[0].inputs.length, 1);
  assert.equal(selected[0].inputs[0].protocol === protocol, true);
  assert.equal(current.plan.unresolved.length, 0, current.plan.unresolved.map(value => value.reason).join("; "));
  assert.equal(current.plan.forProtocol(protocol) === selected, true);
  assert.equal(Object.isFrozen(current.plan) && Object.isFrozen(selected) && Object.isFrozen(selected[0]), true);
});

test("equal generic signatures retain distinct inputs while selecting their actual shared family", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    export function invoke(left: Identity, right: Identity): number {
      return left<number>(7) + right<number>(8);
    }
    export function main(): number {
      const left = <Value>(value: Value): Value => value;
      const right = <Value>(value: Value): Value => value;
      return invoke(left, right);
    }
  `);
  const inputs = current.native.inputsFor(current.declaration("invoke"));
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].implementation.identity !== inputs[1].implementation.identity, true);
  for (const input of inputs) {
    const selected = current.plan.forProtocol(input.protocol);
    assert.equal(selected.length, 2);
    const binding = selected.find(binding => binding.inputs.includes(input));
    assert.equal(binding !== undefined, true, "exact input evidence is retained on its physical family");
    assert.equal(binding.definition.members.length, 1);
  }
  assert.equal(current.plan.unresolved.length, 0, current.plan.unresolved.map(value => value.reason).join("; "));
});

test("pure forwarding records downstream protocol bounds without depending on escaping errors", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    export function retain(callback: Identity): Identity { return callback; }
    export function forward(left: Identity, right: Identity): Identity {
      const first = retain(left); const second = retain(right); return second;
    }
    export function ordinary(callback: () => number): () => number { return callback; }
    export function plain(callback: () => number): () => number { return ordinary(callback); }
  `);
  for (const [ownerName, calleeName, count] of [["forward", "retain", 2], ["plain", "ordinary", 1]]) {
    const owner = current.declaration(ownerName);
    const inputs = current.native.inputsFor(owner);
    const target = current.native.inputsFor(current.declaration(calleeName))[0];
    const selected = current.plan.forwardingFor(owner);
    assert.equal(selected.length, count, ownerName);
    for (const input of inputs) {
      const relation = selected.find(value => value.input === input);
      assert.equal(relation !== undefined, true, ownerName);
      assert.equal(relation.owner === owner, true);
      assert.equal(relation.trait.id, target.protocol.identity);
      assert.equal(input.protocol.identity === relation.trait.id, true, "equal normalized protocol declarations are shared");
    }
  }
  assert.equal(current.plan.bindings.length, 0, "open formals do not invent concrete family impls");
  assert.equal(current.plan.open.length, 2, "open generic invocations remain explicit");
  assert.equal(current.plan.unresolved.length, 0, current.plan.unresolved.map(value => value.reason).join("; "));
});

test("unresolved concrete storage is explicit and cannot be replaced by equal-signature families", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    function invoke(callback: Identity): number { return callback<number>(7); }
    export function main(): number {
      const callback = <Value>(value: Value): Value => value; return invoke(callback);
    }
  `);
  const plan = producerPlan({ ...current.options, nativeStorage: {
    ...current.options.nativeStorage,
    invocationOriginsFor() { return { kind: "unresolved", reason: "unavailable exact binding" }; },
  } });
  assert.equal(plan.bindings.length, 0);
  assert.equal(plan.unresolved.length, 1);
  assert.equal(plan.unresolved[0].reason, "unavailable exact binding");
});

test("open producer enumeration preserves symbolic obligations and never substitutes an available family for an unknown input", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    export function retain(callback: Identity): Identity { return callback; }
    export function forward(callback: Identity): Identity { return retain(callback); }
    export function known(): Identity {
      const callback = <Value>(value: Value): Value => value;
      return forward(callback);
    }
  `, { target: { id: "rust", options: { outputType: "lib" } } });
  const retained = current.native.inputsFor(current.declaration("retain"))[0];
  const forwarded = current.native.inputsFor(current.declaration("forward"))[0];
  const origins = current.options.nativeStorage.implementationOriginsFor(retained);
  assert.equal(origins.kind, "open");
  assert.equal(origins.boundaries.length > 0, true);
  assert.equal(origins.producers.length > 0, true, "known concrete producers may still require legal native impls");
  const symbolic = current.options.nativeStorage.subjectFor(forwarded.subject, forwarded.carrier, forwarded.owner);
  assert.equal(symbolic.kind, "selected");
  assert.equal(symbolic.carrier === forwarded.implementation, true, "the public input remains its own unknown C");
  assert.equal(current.plan.open.some(entry => entry.input === retained && entry.inputs.includes(forwarded)), true);
  assert.equal(current.plan.forwardingFor(current.declaration("forward")).some(entry =>
    entry.input === forwarded && entry.trait.id === retained.protocol.identity), true);
  const missing = producerPlan({ ...current.options, nativeStorage: {
    ...current.options.nativeStorage,
    implementationOriginsFor(input) {
      return input === retained ? { kind: "open", producers: [], boundaries: origins.boundaries }
        : current.options.nativeStorage.implementationOriginsFor(input);
    },
    invocationOriginsFor(input, invocation, owner) {
      return input === retained ? { kind: "unresolved", reason: "missing exact abstract input binding" }
        : current.options.nativeStorage.invocationOriginsFor(input, invocation, owner);
    },
  } });
  assert.equal(missing.unresolved.some(entry => entry.input === retained && entry.reason === "missing exact abstract input binding"), true);
  assert.equal(missing.forProtocol(retained.protocol).some(binding => binding.inputs.includes(retained)), false,
    "a known equal-signature implementation cannot replace a missing exact invocation binding");
});

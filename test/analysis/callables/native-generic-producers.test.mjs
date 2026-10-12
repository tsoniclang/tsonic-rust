import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createRustNativeCallableInputPlan } from "../../../dist/analysis/callables/native-inputs.js";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native-producers.js";
import { createRustNativeStoragePlan } from "../../../dist/analysis/callables/native-storage.js";
import { createRustNativeGenericProducerPlan } from "../../../dist/analysis/callables/native-generic-producers.js";

function fixture(text) {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
  const source = createTargetSourceProgram(checked);
  const storage = createSourceStorageQuery(source, program.sourceFiles);
  const input = { ast: source.ast, storage, facts: program.facts, definitions: program.typeDefinitions };
  const native = createRustNativeCallableInputPlan({ ...input, usedNames: new Set() });
  const producers = createRustNativeCallableProducerPlan({ ...input, native, nodes: storage.nodes,
    returnCarrierFor: declaration => {
      const selected = nativeStorage.returnFor(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  const nativeStorage = createRustNativeStoragePlan({ ...input, native, producers });
  const options = { ...input, nodes: storage.nodes, generic: program.callableValues.generic, native, nativeStorage };
  const plan = createRustNativeGenericProducerPlan(options);
  const declaration = name => storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
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
  assert.equal(selected[0].definition === current.program.callableValues.generic.definitions[0], true);
  assert.equal(selected[0].input.protocol === protocol, true);
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
    assert.equal(selected.length, 1);
    assert.equal(selected[0].input === input, true);
    assert.equal(selected[0].definition.implementations.length > 0, true);
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
      assert.equal(input.protocol.identity !== relation.trait.id, true);
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
  const plan = createRustNativeGenericProducerPlan({ ...current.options, storage: {
    ...current.options.storage,
    bindingsForInvocation() { return { kind: "unresolved", reason: "unavailable exact binding" }; },
  } });
  assert.equal(plan.bindings.length, 0);
  assert.equal(plan.unresolved.length, 1);
  assert.equal(plan.unresolved[0].reason, "unavailable exact binding");
});

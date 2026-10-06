import assert from "node:assert/strict";
import test from "node:test";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { collectRustProviderSemanticsFromDefinitions, mergeRustProviderSemantics } from "../../../dist/providers/packages/index.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/index.js";
import { analyzeRustBinaryHooks } from "../../../dist/analysis/runtime/hooks.js";
import { dispatchContextDefinition, dispatchProviderDefinition } from "../../helpers/rust-session/provider-dispatch-contexts.mjs";

export function dispatchGroup(overrides = {}) {
  return {
    contextId: "acme.dispatch",
    targetArgumentIndex: 0,
    empty: { form: "associated-call", owner: dispatchContextDefinition().rootCarrier, method: "new" },
    prepend: { form: "call", path: "runtime::prepend" },
    ...overrides,
  };
}

function definition(group = dispatchGroup(), phase = "after-entry") {
  return dispatchProviderDefinition({ binaryHooks: [{
    id: "drain", phase, path: "runtime::drain", requiredCrate: "acme_dispatch",
    dispatchGroups: [group], isFallible: true, errorBoundary: "source-program",
  }] });
}

test("dispatch groups materialize aliases and exact native empty constructor carriers", () => {
  const semantics = collectRustProviderSemanticsFromDefinitions([definition()]);
  const group = semantics.binaryHooks[0].dispatchGroups[0];
  assert.equal(group.prepend.path, "acme_dispatch::prepend");
  assert.equal(rustNamedTypeCarrierValue(group.empty.owner)?.path, "acme_dispatch::Dispatch");
  assert.equal(rustNamedTypeCarrierValue(group.empty.owner)?.genericArguments[0].type.id, "rust.program.TsonicError");
  const hooks = analyzeRustBinaryHooks(semantics.binaryHooks, ["acme_dispatch"]);
  assert.equal(hooks[0].dispatchGroups, semantics.binaryHooks[0].dispatchGroups);
  assert.equal(Object.isFrozen(hooks[0].dispatchGroups), true);
});

test("dispatch groups snapshot every caller-owned constructor and selection", () => {
  const input = definition();
  const captured = createRustProviderPackage(input).createTargetContributions()[0].definition;
  input.binaryHooks[0].dispatchGroups[0].contextId = "wrong";
  input.binaryHooks[0].dispatchGroups[0].prepend.path = "runtime::wrong";
  input.binaryHooks[0].dispatchGroups[0].empty.owner.genericArguments[0].type.id = "wrong";
  const row = collectRustProviderSemanticsFromDefinitions([captured]).binaryHooks[0];
  assert.equal(row.dispatchGroups[0].contextId, "acme.dispatch");
  assert.equal(row.dispatchGroups[0].prepend.path, "acme_dispatch::prepend");
  assert.equal(rustNamedTypeCarrierValue(row.dispatchGroups[0].empty.owner)?.genericArguments[0].type.id, "rust.program.TsonicError");
  for (const value of [row.dispatchGroups, row.dispatchGroups[0], row.dispatchGroups[0].empty,
    row.dispatchGroups[0].empty.owner, row.dispatchGroups[0].prepend]) assert.equal(Object.isFrozen(value), true);
});

test("dispatch groups reject invalid positions and repeated selection identities", () => {
  for (const position of [-1, 1, 0.5, "0", NaN, Infinity, 9007199254740993n]) {
    assert.throws(() => createRustProviderPackage(definition(dispatchGroup({ targetArgumentIndex: position }))));
  }
  for (const position of [0, 1]) {
    assert.doesNotThrow(() => createRustProviderPackage(definition(dispatchGroup({ targetArgumentIndex: position }), "async-execution")));
  }
  const repeated = definition();
  repeated.binaryHooks[0].dispatchGroups.push(dispatchGroup());
  assert.throws(() => createRustProviderPackage(repeated), /distinct non-empty context/u);
  repeated.binaryHooks[0].dispatchGroups[1].contextId = "another";
  assert.throws(() => createRustProviderPackage(repeated), /distinct valid target argument/u);
  repeated.binaryHooks[0].dispatchGroups[1].targetArgumentIndex = 1;
  assert.doesNotThrow(() => createRustProviderPackage(repeated));
});

test("dispatch groups reject malformed constructors, free generics and non-dense metadata", () => {
  const invalid = [
    dispatchGroup({ contextId: "" }),
    dispatchGroup({ unexpected: true }),
    dispatchGroup({ empty: { ...dispatchGroup().empty, form: "call" } }),
    dispatchGroup({ empty: { ...dispatchGroup().empty, method: "new()" } }),
    dispatchGroup({ prepend: { form: "call", path: "runtime::prepend()" } }),
    dispatchGroup({ prepend: { form: "call", path: "runtime::prepend", argModes: [] } }),
    dispatchGroup({ prepend: { form: "receiver-method", name: "prepend" } }),
    dispatchGroup({ empty: { ...dispatchGroup().empty, owner: { kind: "target-named", id: "missing" } } }),
  ];
  for (const group of invalid) assert.throws(() => createRustProviderPackage(definition(group)));
  for (const argument of [
    { kind: "type", type: { kind: "type-parameter", identity: "free", name: "T" } },
    { kind: "lifetime", lifetime: { kind: "parameter", identity: "free", name: "a" } },
    { kind: "const", value: { kind: "parameter", identity: "free", name: "N" } },
  ]) {
    const group = dispatchGroup();
    group.empty.owner.genericArguments = [argument];
    assert.throws(() => createRustProviderPackage(definition(group)), /closed component-owned/u);
  }
  const sparse = definition();
  sparse.binaryHooks[0].dispatchGroups = new Array(1);
  assert.throws(() => createRustProviderPackage(sparse), /contains a sparse, accessor-backed, or custom-property array/u);
});

test("conflicting native group constructors cannot share one binary hook identity", () => {
  const first = collectRustProviderSemanticsFromDefinitions([definition()]);
  const second = collectRustProviderSemanticsFromDefinitions([definition(dispatchGroup({
    prepend: { form: "call", path: "runtime::different" },
  }))]);
  assert.throws(() => mergeRustProviderSemantics(first, second), /conflicting definitions/u);
});

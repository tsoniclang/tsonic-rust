import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustBinaryDispatchDemand } from "../../../dist/analysis/runtime/binary-dispatch-demand.js";
import { analyzeRustDispatchContextCatalog } from "../../../dist/analysis/runtime/dispatch-contexts.js";
import { dispatchContextDefinition } from "../../helpers/rust-session/provider-dispatch-contexts.mjs";

function group() {
  return { contextId: "acme.dispatch", targetArgumentIndex: 0,
    empty: { form: "associated-call", owner: dispatchContextDefinition().rootCarrier, method: "new" },
    prepend: { form: "call", path: "acme_dispatch::prepend" } };
}

function fixture(demanded = [], rows = [
  ["root", ["left", "right"]], ["left", ["leaf"]], ["right", ["leaf"]], ["leaf", []],
]) {
  const catalog = analyzeRustDispatchContextCatalog([dispatchContextDefinition()], ["acme_dispatch"]);
  assert.equal(catalog.kind, "resolved");
  const components = rows.map(([componentId, dependencyComponentIds]) => ({ componentId, dependencyComponentIds,
    errorDomain: "project", root: componentId === "root" }));
  const byId = new Map(components.map(component => [component.componentId, component]));
  const selections = new Map(components.map(component => {
    const selected = catalog.plan.compose(demanded.includes(component.componentId) ? ["acme.dispatch"] : []);
    assert.equal(selected.kind, "resolved");
    return [component.componentId, selected.plan];
  }));
  return { components: { components, rootComponentId: "root", forComponent: id => byId.get(id) },
    contexts: catalog.plan, demand: { forComponent: id => selections.get(id) },
    hooks: [{ id: "drain", phase: "after-entry", path: "acme_dispatch::drain", dispatchGroups: [group()],
      isFallible: true, errorBoundary: "source-program" }] };
}

function analyze(input) {
  return analyzeRustBinaryDispatchDemand(input.hooks, input.components, input.contexts, input.demand);
}

test("unused groups do not demand native roots or link source-package crates", () => {
  const result = analyze(fixture());
  assert.equal(result.kind, "resolved");
  assert.deepEqual(result.plan.linkedComponentIds, []);
  assert.deepEqual(result.plan.forHook("drain")[0].components, []);
  assert.equal(result.plan.forHook("unknown"), undefined);
});

test("dependency diamonds dispatch each native owner once through real error dependency edges", () => {
  const result = analyze(fixture(["leaf", "right"]));
  assert.equal(result.kind, "resolved");
  const rows = result.plan.forHook("drain")[0].components;
  assert.deepEqual(rows.map(row => row.componentId), ["leaf", "right", "left", "root"]);
  assert.deepEqual(rows.find(row => row.componentId === "left").children, ["leaf"]);
  assert.deepEqual(rows.find(row => row.componentId === "right").children, []);
  assert.deepEqual(rows.find(row => row.componentId === "root").children, ["left", "right"]);
  assert.equal(rows.filter(row => row.componentId === "leaf").length, 1);
  assert.deepEqual(new Set(result.plan.linkedComponentIds), new Set(["left", "right", "leaf"]));
  for (const row of rows) {
    assert.equal(Object.isFrozen(row), true);
    assert.equal(Object.isFrozen(row.children), true);
  }
});

test("binary dispatch rejects unavailable context identities, components and unsealed demand", () => {
  const unknown = fixture();
  unknown.hooks[0].dispatchGroups[0].contextId = "missing";
  const missingContext = analyze(unknown);
  assert.equal(missingContext.kind, "rejected");
  assert.equal(missingContext.diagnostics[0].code, "RUST_BINARY_DISPATCH_DEMAND_INVALID");
  const missingComponent = fixture([], [["root", ["missing"]]]);
  assert.equal(analyze(missingComponent).kind, "rejected");
  const unsealed = fixture();
  unsealed.demand.forComponent = () => undefined;
  assert.equal(analyze(unsealed).kind, "rejected");
});

test("deep native dependency routing is iterative and bounded rather than recursive", () => {
  const rows = Array.from({ length: 2048 }, (_, index) => [index === 0 ? "root" : `node${index}`,
    index === 2047 ? [] : [`node${index + 1}`]]);
  const result = analyze(fixture(["node2047"], rows));
  assert.equal(result.kind, "resolved");
  assert.equal(result.plan.forHook("drain")[0].components.length, 2048);
  assert.equal(result.plan.linkedComponentIds.length, 2047);
  assert.equal(result.plan.forHook("drain")[0].components[0].componentId, "node2047");
  assert.equal(result.plan.forHook("drain")[0].components.at(-1).componentId, "root");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRustDispatchContextCatalog } from "../../../dist/analysis/runtime/index.js";
import { collectRustProviderSemanticsFromDefinitions } from "../../../dist/providers/packages/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import {
  dispatchContextDefinition as context,
  dispatchProviderDefinition as definition,
} from "../../helpers/rust-session/provider-dispatch-contexts.mjs";

const projection = contextId => ({ contextId, project: { form: "receiver-method", name: contextId } });

function catalog(contexts) {
  const semantics = collectRustProviderSemanticsFromDefinitions([definition({ dispatchContexts: contexts })]);
  const result = analyzeRustDispatchContextCatalog(semantics.dispatchContexts, ["acme_dispatch"]);
  assert.equal(result.kind, "resolved", "exact native context declarations resolve");
  return result.plan;
}

test("context demand selects no roots for context-free programs and no unused parent", () => {
  const selected = catalog([context({ id: "outer", composedContexts: [projection("inner")] }),
    context({ id: "inner" })]);
  const empty = selected.compose([]);
  assert.equal(empty.kind, "resolved");
  assert.equal(empty.plan.rootContextIds.length, 0);
  assert.equal(empty.plan.access("outer"), undefined);
  const inner = selected.compose(["inner"]);
  assert.equal(inner.kind, "resolved");
  assert.deepEqual(inner.plan.rootContextIds, ["inner"]);
  assert.equal(inner.plan.access("inner")?.rootContextId, "inner");
  assert.equal(inner.plan.access("outer"), undefined);
});

test("composed context demand has one physical root and exact immutable projections", () => {
  const selected = catalog([
    context({ id: "outer", composedContexts: [projection("middle")] }),
    context({ id: "middle", composedContexts: [projection("inner")] }),
    context({ id: "inner" }),
  ]);
  const result = selected.compose(["inner", "outer", "middle", "outer"]);
  assert.equal(result.kind, "resolved");
  assert.deepEqual(result.plan.rootContextIds, ["outer"]);
  const access = result.plan.access("inner");
  assert.equal(access?.rootContextId, "outer");
  assert.deepEqual(access?.projections.map(value => value.name), ["middle", "inner"]);
  assert.equal(result.plan.access("inner") === access, true, "published path is reused");
  assert.equal(Object.isFrozen(access), true);
  assert.equal(Object.isFrozen(access?.projections), true);
  assert.equal(Object.isFrozen(result.plan), true);
});

test("independent roots and native spelling are deterministic across declaration and demand order", () => {
  const declarations = [context({ id: "mixedCase" }), context({ id: "other" })];
  const first = catalog(declarations).compose(["other", "mixedCase"]);
  const second = catalog(declarations.toReversed()).compose(["mixedCase", "other"]);
  assert.equal(first.kind, "resolved");
  assert.equal(second.kind, "resolved");
  assert.deepEqual(first.plan.rootContextIds, ["mixedCase", "other"]);
  assert.deepEqual(first.plan.rootContextIds, second.plan.rootContextIds);
  assert.equal(first.plan.access("mixed_case"), undefined);
});

test("context catalog rejects missing, cyclic, duplicate and inactive composition identities", () => {
  const declarations = [
    [context({ id: "outer", composedContexts: [projection("missing")] })],
    [context({ id: "outer", composedContexts: [projection("inner")] }),
      context({ id: "inner", composedContexts: [projection("outer")] })],
  ];
  for (const dispatchContexts of declarations) {
    const rows = collectRustProviderSemanticsFromDefinitions([definition({ dispatchContexts })]).dispatchContexts;
    const result = analyzeRustDispatchContextCatalog(rows, ["acme_dispatch"]);
    assert.equal(result.kind, "rejected");
    assert.equal(result.diagnostics[0]?.code, "RUST_DISPATCH_CONTEXT_INVALID");
  }
  const rows = collectRustProviderSemanticsFromDefinitions([definition()]).dispatchContexts;
  assert.equal(analyzeRustDispatchContextCatalog([...rows, ...rows], ["acme_dispatch"]).kind, "rejected");
  const inactiveChild = [
    { ...rows[0], id: "outer", composedContexts: [projection("inner")] },
    { ...rows[0], id: "inner", requiredCrate: "inactive" },
  ];
  assert.equal(analyzeRustDispatchContextCatalog(inactiveChild, ["acme_dispatch"]).kind, "rejected");
});

test("physical context ownership never guesses between demanded roots or diamond projections", () => {
  const selected = catalog([
    context({ id: "left", composedContexts: [projection("shared")] }),
    context({ id: "right", composedContexts: [projection("shared")] }),
    context({ id: "shared" }),
  ]);
  assert.equal(selected.compose(["left", "right"]).kind, "rejected");
  assert.equal(selected.compose(["left", "right", "shared"]).kind, "rejected");
  assert.equal(selected.compose(["shared"]).kind, "resolved");
  const diamond = catalog([
    context({ id: "root", composedContexts: [projection("left"), projection("right")] }),
    context({ id: "left", composedContexts: [projection("shared")] }),
    context({ id: "right", composedContexts: [projection("shared")] }),
    context({ id: "shared" }),
  ]);
  assert.equal(diamond.compose(["root"]).kind, "rejected");
});

test("context input queries select exact owned root and handle carriers without error erasure", () => {
  const selected = catalog([context()]);
  for (const [view, mode] of [["root", "ref"], ["handle", "value"], ["handle", "ref"]]) {
    const input = { contextId: "acme.dispatch", view, targetArgumentIndex: 1, mode };
    const resolved = selected.resolveInput(input);
    assert.equal(resolved !== undefined, true, "native input resolves");
    assert.equal(rustTargetTypeRefEquals(resolved.carrier,
      view === "root" ? selected.declaration(input.contextId).rootCarrier
        : selected.declaration(input.contextId).handleCarrier), true, "exact selected carrier");
    input.contextId = "wrong";
    assert.equal(resolved.contextId, "acme.dispatch");
    assert.equal(Object.isFrozen(resolved), true);
  }
  assert.equal(selected.declaration("absent"), undefined);
});

test("context queries reject malformed indices, ownership modes, invented carriers and demand", () => {
  const selected = catalog([context()]);
  const valid = { contextId: "acme.dispatch", view: "handle", targetArgumentIndex: 0, mode: "value" };
  for (const change of [
    { contextId: "missing" }, { contextId: "" }, { view: "any" }, { view: "root" },
    { mode: "mut-ref" }, { targetArgumentIndex: -1 }, { targetArgumentIndex: 0.5 },
    { targetArgumentIndex: Infinity }, { targetArgumentIndex: 2 ** 53 },
    { carrier: { kind: "source-primitive", name: "int32" } },
  ]) {
    assert.equal(selected.resolveInput({ ...valid, ...change }), undefined);
  }
  for (const malformed of [null, [], {}, { ...valid, get view() { throw new Error("getter must not run"); } }]) {
    assert.equal(selected.resolveInput(malformed), undefined);
  }
  for (const demand of [null, {}, ["missing"], [null], new Array(1)]) {
    assert.equal(selected.compose(demand).kind, "rejected");
  }
});

test("deep context composition uses iterative accounting and publishes only requested paths", () => {
  const count = 2_048;
  const contexts = Array.from({ length: count }, (_, index) => context({
    id: `context${index}`,
    composedContexts: index + 1 === count ? [] : [projection(`context${index + 1}`)],
  }));
  const result = catalog(contexts).compose(["context0", `context${count - 1}`]);
  assert.equal(result.kind, "resolved");
  assert.equal(result.plan.rootContextIds.length, 1);
  assert.equal(result.plan.access(`context${count - 1}`)?.projections.length, count - 1);
});

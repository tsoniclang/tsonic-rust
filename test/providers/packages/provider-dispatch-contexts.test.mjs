import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import {
  collectRustProviderSemanticsFromDefinitions,
  mergeRustProviderSemantics,
} from "../../../dist/providers/packages/index.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/index.js";

function context(overrides = {}) {
  return {
    id: "acme.dispatch",
    requiredCrate: "acme_dispatch",
    rootCarrier: { kind: "target-named", id: "acme.Dispatch", genericArguments: [
      { kind: "type", type: { kind: "target-named", id: "rust.program.TsonicError" } },
    ] },
    construct: { form: "call", path: "runtime::Dispatch::new" },
    handleCarrier: { kind: "target-named", id: "acme.DispatchHandle", genericArguments: [
      { kind: "type", type: { kind: "target-named", id: "rust.program.TsonicError" } },
    ] },
    handle: { form: "receiver-method", name: "handle" },
    composedContexts: [],
    ...overrides,
  };
}

function definition(overrides = {}) {
  return {
    id: "acme-dispatch",
    displayName: "Acme dispatch",
    version: "1.0.0",
    modules: [{ moduleSpecifier: "@acme/dispatch", providerModuleId: "acme.dispatch", exports: [] }],
    operations: [],
    crates: [{ crateName: "acme_dispatch", cargoPath: resolve("test/fixtures/crates/acme_files") }],
    carrierPaths: {
      "acme.Dispatch": "acme_dispatch::Dispatch",
      "acme.DispatchHandle": "acme_dispatch::DispatchHandle",
    },
    aliasImports: [{ alias: "runtime", path: "acme_dispatch" }],
    dispatchContexts: [context()],
    ...overrides,
  };
}

test("dispatch contexts materialize exact native carriers, generic errors and factory aliases", () => {
  const semantics = collectRustProviderSemanticsFromDefinitions([definition()]);
  const row = semantics.dispatchContexts[0];
  assert.equal(row.providerPackageId, "acme-dispatch");
  assert.equal(row.providerVersion, "1.0.0");
  assert.equal(row.construct.path, "acme_dispatch::Dispatch::new");
  assert.equal(rustNamedTypeCarrierValue(row.rootCarrier)?.path, "acme_dispatch::Dispatch");
  assert.equal(rustNamedTypeCarrierValue(row.handleCarrier)?.path, "acme_dispatch::DispatchHandle");
  assert.equal(rustNamedTypeCarrierValue(row.rootCarrier)?.genericArguments[0]?.type.id,
    "rust.program.TsonicError");
});

test("dispatch context publication snapshots every mutable provider input", () => {
  const input = definition();
  const provider = createRustProviderPackage(input);
  input.dispatchContexts[0].construct.path = "runtime::wrong";
  input.dispatchContexts[0].handle.name = "wrong";
  input.dispatchContexts[0].composedContexts.push({ contextId: "wrong", project: {
    form: "receiver-method", name: "wrong",
  } });
  const captured = provider.createTargetContributions()[0].definition;
  const row = collectRustProviderSemanticsFromDefinitions([captured]).dispatchContexts[0];
  assert.equal(row.construct.path, "acme_dispatch::Dispatch::new");
  assert.equal(row.handle.name, "handle");
  assert.equal(row.composedContexts.length, 0);
  for (const value of [row, row.rootCarrier, row.handleCarrier, row.construct, row.handle,
    row.composedContexts]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test("dispatch context identity has one exact owner and idempotent publication", () => {
  const original = collectRustProviderSemanticsFromDefinitions([definition()]);
  assert.equal(mergeRustProviderSemantics(original, original).dispatchContexts.length, 1);
  for (const alternate of [
    definition({ id: "other-owner" }),
    definition({ version: "2.0.0" }),
    definition({ dispatchContexts: [context({ handle: { form: "receiver-method", name: "other" } })] }),
  ]) {
    assert.throws(() => mergeRustProviderSemantics(original,
      collectRustProviderSemanticsFromDefinitions([alternate])),
    /dispatch context .* has conflicting definitions/u);
  }
});

test("dispatch contexts preserve exact composed-root projections without guessing external owners", () => {
  const composed = { contextId: "other.dispatch", project: { form: "receiver-method", name: "other" } };
  const semantics = collectRustProviderSemanticsFromDefinitions([definition({
    dispatchContexts: [context({ composedContexts: [composed] })],
  })]);
  const row = semantics.dispatchContexts[0];
  assert.equal(row.composedContexts[0].contextId, "other.dispatch");
  assert.equal(row.composedContexts[0].project.name, "other");
  assert.equal(Object.isFrozen(row.composedContexts[0].project), true);
});

test("dispatch contexts reject malformed declarations and unsupported execution forms", () => {
  const invalid = [
    { id: "" },
    { requiredCrate: "missing" },
    { rootCarrier: { kind: "reference", referent: { kind: "source-primitive", name: "int32" }, mutable: false } },
    { rootCarrier: { kind: "target-named", id: "acme.Undeclared" } },
    { handleCarrier: { kind: "source-primitive", name: "int32" } },
    { construct: null },
    { construct: { form: "path", path: "runtime::Dispatch::new" } },
    { construct: { form: "call", path: "runtime::Dispatch::new()" } },
    { construct: { form: "call", path: "runtime::Dispatch::new", argModes: ["value"] } },
    { handle: null },
    { handle: { form: "method", name: "handle" } },
    { handle: { form: "receiver-method", name: "handle()" } },
    { handle: { form: "receiver-method", name: "handle", receiverMode: "mut-ref" } },
    { composedContexts: null },
    { composedContexts: {} },
    { composedContexts: [null] },
    { composedContexts: [{ contextId: "", project: { form: "receiver-method", name: "other" } }] },
    { composedContexts: [{ contextId: "acme.dispatch", project: { form: "receiver-method", name: "other" } }] },
    { composedContexts: [{ contextId: "other.dispatch", project: null }] },
    { composedContexts: [{ contextId: "other.dispatch", project: {
      form: "receiver-method", name: "other", offset: 0,
    } }] },
    { surprise: true },
  ];
  for (const [index, change] of invalid.entries()) {
    assert.throws(() => createRustProviderPackage(definition({ dispatchContexts: [context(change)] })),
      /Provider package 'acme-dispatch':/u, `malformed dispatch context ${index}`);
  }
});

test("dispatch contexts reject non-arrays, duplicates and unsafe metadata at the boundary", () => {
  const child = { contextId: "other.dispatch", project: { form: "receiver-method", name: "other" } };
  for (const value of [
    null, {}, [null], [context(), context()],
    [context({ composedContexts: [child, child] })],
    [context({ composedContexts: [undefined] })],
    [context({ composedContexts: new Array(1) })],
    [context({ construct: { form: "call", path: "runtime::Dispatch::new", bad: Infinity } })],
    [context({ handle: { get form() { throw new Error("getter must not run"); }, name: "handle" } })],
  ]) {
    assert.throws(() => createRustProviderPackage(definition({ dispatchContexts: value })),
      /Provider package 'acme-dispatch':/u);
  }
  const cyclic = context();
  cyclic.composedContexts.push(cyclic);
  assert.throws(() => createRustProviderPackage(definition({ dispatchContexts: [cyclic] })),
    /contains a cycle/u);
});

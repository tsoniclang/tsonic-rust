import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import {
  collectRustProviderSemanticsFromDefinitions,
  mergeRustProviderSemantics,
} from "../../../dist/providers/packages/index.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/index.js";
import {
  dispatchContextDefinition as context,
  dispatchProviderDefinition as definition,
} from "../../helpers/rust-session/provider-dispatch-contexts.mjs";

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

test("component-owned contexts accept closed native generics and reject unbound parameters", () => {
  const closed = [
    { kind: "type", type: { kind: "source-primitive", name: "int32" } },
    { kind: "lifetime", lifetime: { kind: "static" } },
    { kind: "const", value: { kind: "integer", value: "4" } },
  ];
  for (const label of ["rootCarrier", "handleCarrier"]) {
    const carrier = context()[label];
    assert.doesNotThrow(() => createRustProviderPackage(definition({ dispatchContexts: [context({
      [label]: { ...carrier, genericArguments: closed },
    })] })));
    for (const argument of [
      { kind: "type", type: { kind: "type-parameter", identity: "free-type", name: "T" } },
      { kind: "lifetime", lifetime: { kind: "parameter", identity: "free-lifetime", name: "a" } },
      { kind: "lifetime", lifetime: { kind: "placeholder" } },
      { kind: "const", value: { kind: "parameter", identity: "free-const", name: "N" } },
    ]) {
      assert.throws(() => createRustProviderPackage(definition({ dispatchContexts: [context({
        [label]: { ...carrier, genericArguments: [argument] },
      })] })), /closed component-owned native carrier/u, `${label}: ${argument.kind}`);
    }
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

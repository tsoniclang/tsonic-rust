import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustProviderPackage } from "../dist/index.js";

const int32 = { kind: "source-primitive", name: "int32" };
const unit = { kind: "tuple", elements: [] };

function storeDefinition(operations, { readonlyProperty = false } = {}) {
  return {
    id: "acme-store-setters",
    displayName: "Acme store setters",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/store-setters",
      providerModuleId: "acme.store.setters",
      exports: [{
        id: "acme.Store",
        name: "Store",
        kind: "class",
        members: [
          {
            id: "acme.Store.value",
            name: "value",
            kind: "property",
            ...(readonlyProperty ? { readonly: true } : {}),
            type: { kind: "source-primitive", name: "int32" },
          },
          {
            id: "acme.Store.index",
            name: "index",
            kind: "indexer",
            signatures: [{
              id: "acme.Store.index(int32)",
              parameters: [{ name: "index", type: { kind: "source-primitive", name: "int32" } }],
              returnType: { kind: "source-primitive", name: "int32" },
            }],
          },
        ],
      }],
    }],
    operations,
    crates: [],
  };
}

function propertySetter(overrides = {}) {
  return {
    exportId: "acme.Store",
    memberId: "acme.Store.value",
    operationKind: "property-set",
    target: { form: "receiver-method", name: "set_value" },
    resultCarrier: unit,
    parameterCarriers: [int32],
    ...overrides,
  };
}

function indexSetter(overrides = {}) {
  return {
    exportId: "acme.Store",
    memberId: "acme.Store.index",
    signatureId: "acme.Store.index(int32)",
    operationKind: "index-set",
    target: { form: "receiver-method", name: "set" },
    resultCarrier: unit,
    parameterCarriers: [int32, int32],
    ...overrides,
  };
}

test("writable provider property and index signatures accept exact setter ABIs", () => {
  assert.doesNotThrow(() => createRustProviderPackage(
    storeDefinition([propertySetter(), indexSetter()]),
  ));
});

test("provider setter metadata rejects readonly, non-unit, and incomplete contracts", () => {
  assert.throws(
    () => createRustProviderPackage(storeDefinition([propertySetter()], { readonlyProperty: true })),
    /requires a writable provider property declaration/u,
  );
  assert.throws(
    () => createRustProviderPackage(storeDefinition([propertySetter({ resultCarrier: int32 })])),
    /setter result carrier must be Rust unit/u,
  );
  assert.throws(
    () => createRustProviderPackage(storeDefinition([propertySetter({ parameterCarriers: [] })])),
    /property setter must declare exactly one value carrier/u,
  );
  assert.throws(
    () => createRustProviderPackage(storeDefinition([indexSetter({ parameterCarriers: [int32] })])),
    /declares 1 target parameter carriers for 2 selected index\/value inputs/u,
  );
});

test("provider setters cannot smuggle call-only effects or property signature guesses", () => {
  assert.throws(
    () => createRustProviderPackage(storeDefinition([propertySetter({
      isFallible: true,
      errorBoundary: "provider-native",
    })])),
    /isFallible is supported only on method, constructor, and property operations/u,
  );
  assert.throws(
    () => createRustProviderPackage(storeDefinition([propertySetter({ isAsync: true })])),
    /isAsync is supported only on method operations/u,
  );
  assert.throws(
    () => createRustProviderPackage(storeDefinition([
      propertySetter({ signatureId: "acme.Store.index(int32)" }),
    ])),
    /outside its selected declaration|cannot select a property setter by signatureId/u,
  );
});

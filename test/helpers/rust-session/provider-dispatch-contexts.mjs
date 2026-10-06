import { resolve } from "node:path";

export function dispatchContextDefinition(overrides = {}) {
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

export function dispatchProviderDefinition(overrides = {}) {
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
    dispatchContexts: [dispatchContextDefinition()],
    ...overrides,
  };
}

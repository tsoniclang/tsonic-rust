import { resolve } from "node:path";
import { createRustProviderPackage, rustCallableTargetType } from "../../../dist/public/provider.js";

export function dispatchContextDefinition(overrides = {}) {
  return {
    id: "acme.dispatch",
    requiredCrate: "acme_dispatch",
    rootCarrier: { kind: "target-named", id: "acme.Dispatch", genericArguments: [
      { kind: "type", type: { kind: "target-named", id: "rust.program.TsonicError" } },
    ] },
    construct: { form: "call", path: "runtime::Dispatch::new", const: false },
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
    crates: [{ crateName: "acme_dispatch", cargoPath: resolve("test/fixtures/crates/acme_dispatch") }],
    carrierPaths: {
      "acme.Dispatch": "acme_dispatch::Dispatch",
      "acme.DispatchHandle": "acme_dispatch::DispatchHandle",
    },
    aliasImports: [{ alias: "runtime", path: "acme_dispatch" }],
    dispatchContexts: [dispatchContextDefinition()],
    ...overrides,
  };
}

export function dispatchProviderPackage({ composed = false } = {}) {
  const unit = { kind: "tuple", elements: [] };
  const integer = { kind: "source-primitive", name: "int32" };
  const enqueueId = "@acme/dispatch::enqueue";
  const pollId = "@acme/dispatch::poll";
  const input = dispatchProviderDefinition({
    modules: [{ moduleSpecifier: "@acme/dispatch", providerModuleId: "acme.dispatch", exports: [
      { id: enqueueId, name: "enqueue", kind: "function", signatures: [{
        id: `${enqueueId}()`, parameters: [{ name: "callback", type: {
          kind: "function", id: `${enqueueId}::callback`, parameters: [], returnType: { kind: "void" },
        } }], returnType: { kind: "void" },
      }] },
      { id: pollId, name: "poll", kind: "function", signatures: [{
        id: `${pollId}()`, parameters: [], returnType: { kind: "void" },
      }] },
      { id: "@acme/dispatch::constructions", name: "constructions", kind: "function", signatures: [{
        id: "@acme/dispatch::constructions()", parameters: [], returnType: { kind: "source-primitive", name: "int32" },
      }] },
    ] }],
    operations: [
      { exportId: enqueueId, operationKind: "method", target: { form: "call", path: "runtime::enqueue" },
        resultCarrier: unit, parameterCarriers: [rustCallableTargetType([], unit)],
        dispatchInputs: [{ contextId: composed ? "acme.parent" : "acme.dispatch", view: "handle", mode: "value", targetArgumentIndex: 0 }] },
      { exportId: pollId, operationKind: "method", target: { form: "call", path: "runtime::poll" },
        resultCarrier: unit, isFallible: true, errorBoundary: "source-program",
        dispatchInputs: [{ contextId: "acme.dispatch", view: "root", mode: "ref", targetArgumentIndex: 0 }] },
      { exportId: "@acme/dispatch::constructions", operationKind: "method", target: { form: "call", path: "runtime::constructions" },
        resultCarrier: integer },
    ],
  });
  if (composed) {
    input.dispatchContexts.push(dispatchContextDefinition({
      id: "acme.parent", rootCarrier: { ...input.dispatchContexts[0].rootCarrier, id: "acme.Parent" },
      handleCarrier: { ...input.dispatchContexts[0].handleCarrier, id: "acme.ParentHandle" },
      construct: { form: "call", path: "runtime::Parent::new", const: false },
      composedContexts: [{ contextId: "acme.dispatch", project: { form: "receiver-method", name: "child" } }],
    }));
    input.carrierPaths["acme.Parent"] = "acme_dispatch::Parent";
    input.carrierPaths["acme.ParentHandle"] = "acme_dispatch::ParentHandle";
  }
  return createRustProviderPackage(input);
}

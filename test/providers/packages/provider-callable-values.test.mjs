import assert from "node:assert/strict";
import test from "node:test";
import { createRustProviderPackage } from "../../../dist/public/provider.js";

function definition() {
  return {
    id: "acme-callable", displayName: "Acme callable", version: "1.0.0",
    modules: [{ moduleSpecifier: "@acme/callable", providerModuleId: "acme.callable", exports: [{
      id: "callable", name: "callable", kind: "value", type: { kind: "intersection", types: [{
        kind: "function", id: "callable.invoke", parameters: [], returnType: { kind: "void" },
      }] },
    }, {
      id: "members", name: "Members", kind: "interface", members: [{
        id: "members.native", name: "native", kind: "method", signatures: [{
          id: "members.native.invoke", parameters: [], returnType: { kind: "void" },
        }],
      }],
    }] }],
    crates: [], operations: [{ exportId: "callable", signatureId: "callable.invoke", operationKind: "method",
      target: { form: "call", path: "native::invoke", argModes: [] },
      parameterCarriers: [], resultCarrier: { kind: "tuple", elements: [] },
    }],
  };
}

test("provider value calls require their exact callable type signature", () => {
  assert.doesNotThrow(() => createRustProviderPackage(definition()));
  for (const mutate of [
    value => { delete value.operations[0].signatureId; },
    value => { value.operations[0].signatureId = "missing"; },
    value => { value.operations[0].exportId = "members"; value.operations[0].signatureId = "members.native.invoke"; },
    value => { value.modules[0].exports[0].type = { kind: "string" }; },
    value => { value.modules[0].exports[0].type.types.push(structuredClone(value.modules[0].exports[0].type.types[0])); },
    value => { value.modules[0].exports[0].type = { kind: "array", elementType: value.modules[0].exports[0].type }; },
  ]) {
    const changed = definition();
    mutate(changed);
    assert.throws(() => createRustProviderPackage(changed), /selected declaration|property read|duplicate signature/u);
  }
});

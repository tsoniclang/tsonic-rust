import assert from "node:assert/strict";
import { rustProviderContractValidation } from "../../../dist/providers/packages/contracts.js";
import test from "node:test";
import { createRustProviderPackage, rustProgramErrorTargetType } from "../../../dist/public/provider.js";
import { collectRustProviderSemanticsFromDefinitions } from "../../../dist/providers/packages/index.js";

function definition(resultCarrier) {
  return {
    id: "error-owner", displayName: "Error owner", version: "1.0.0",
    modules: [{ moduleSpecifier: "@example/error-owner", providerModuleId: "error-owner", exports: [{
      id: "@example/error-owner::read", name: "read", kind: "function", signatures: [{
        id: "@example/error-owner::read()", name: "read", parameters: [],
        returnType: { kind: "source-primitive", name: "int32" },
      }],
    }] }],
    operations: [{ exportId: "@example/error-owner::read", operationKind: "method",
      target: { form: "call", path: "example::read" }, resultCarrier }],
    crates: [],
  };
}

test("providers preserve immutable logical program error templates without authoring physical owners", () => {
  const errorOwner = { kind: "logical" };
  const carrier = { ...rustProgramErrorTargetType(), errorOwner };
  const provider = createRustProviderPackage(definition(carrier));
  errorOwner.kind = "changed";
  const published = provider.createTargetContributions()[0].definition;
  const result = collectRustProviderSemanticsFromDefinitions([published], rustProviderContractValidation).operations[0].resultCarrier;
  assert.deepEqual(result, rustProgramErrorTargetType());
  assert.equal(Object.isFrozen(published.operations[0].resultCarrier.errorOwner), true);
  for (const owner of [{ kind: "physical", domain: "runtime" },
    { kind: "physical", domain: "project", componentId: "forged" }]) {
    assert.throws(() => createRustProviderPackage(definition(rustProgramErrorTargetType(owner))),
      /compiler-owned physical program error identity/u);
  }
});

test("provider error carriers reject ownerless, unrelated and executable phase metadata", () => {
  const logical = rustProgramErrorTargetType();
  let reads = 0;
  const getter = {};
  Object.defineProperty(getter, "kind", { enumerable: true, get() { reads++; return "logical"; } });
  for (const carrier of [{ kind: "target-named", id: logical.id },
    { ...logical, errorOwner: { kind: "logical", componentId: "forged" } },
    { ...logical, errorOwner: getter },
    { kind: "source-primitive", name: "int32", errorOwner: logical.errorOwner }]) {
    assert.throws(() => createRustProviderPackage(definition(carrier)));
  }
  assert.equal(reads, 0);
});

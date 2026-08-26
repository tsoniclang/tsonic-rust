import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRustProviderPackage,
  rustInt32ToFloat64ValueConversion,
  rustCallableTargetType,
  rustClosureTargetType,
} from "../../../dist/public/provider.js";
import {
  collectRustProviderOperationRows,
  collectRustProviderSemantics,
  collectRustProviderSemanticsFromDefinitions,
  createRustProviderPackageSourceProvider,
  mergeRustProviderSemantics,
} from "../../../dist/providers/packages/index.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/index.js";
import { captureRustProviderContributions } from "../../helpers/provider-contributions.mjs";

const int32Carrier = { kind: "source-primitive", name: "int32" };

function functionExport(moduleSpecifier, name = "run") {
  return {
    id: `${moduleSpecifier}::${name}`,
    name,
    kind: "function",
    signatures: [{
      id: `${moduleSpecifier}::${name}()`,
      name,
      parameters: [],
      returnType: { kind: "source-primitive", name: "int32" },
    }],
  };
}

function definition(overrides = {}) {
  return {
    id: "acme-validation",
    displayName: "Acme validation",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@acme/validation",
      providerModuleId: "acme.validation",
      exports: [functionExport("@acme/validation")],
    }],
    operations: [{
      exportId: "@acme/validation::run",
      operationKind: "method",
      target: { form: "call", path: "acme_validation::run" },
      resultCarrier: int32Carrier,
    }],
    crates: [],
    ...overrides,
  };
}

function providerContext(selectedCapabilities) {
  return captureRustProviderContributions(selectedCapabilities);
}

test("argument permutations and structured constants fail closed when malformed", () => {
  const exported = functionExport("@acme/validation");
  exported.signatures[0].parameters = [
    { name: "left", type: { kind: "number" } },
    { name: "right", type: { kind: "number" } },
  ];
  const operation = (target) => ({
    exportId: "@acme/validation::run",
    operationKind: "method",
    target,
    resultCarrier: int32Carrier,
    parameterCarriers: [int32Carrier, int32Carrier],
  });
  assert.throws(
    () => createRustProviderPackage(definition({
      modules: [{ moduleSpecifier: "@acme/validation", providerModuleId: "acme.validation", exports: [exported] }],
      operations: [operation({ form: "call", path: "acme_validation::run", argOrder: [0, 0] })],
    })),
    /not a valid parameter permutation/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      modules: [{ moduleSpecifier: "@acme/validation", providerModuleId: "acme.validation", exports: [exported] }],
      operations: [operation({
        form: "call",
        path: "acme_validation::run",
        trailingArguments: [{ kind: "integer", value: Number.MAX_SAFE_INTEGER + 1 }],
      })],
    })),
    /must contain a safe integer/u,
  );
});

test("provider operation variants and constants reject malformed runtime metadata", () => {
  const operation = (target) => ({
    exportId: "@acme/validation::run",
    operationKind: "method",
    target,
    resultCarrier: int32Carrier,
  });
  assert.throws(
    () => createRustProviderPackage(definition({ operations: [operation({ form: "guess", path: "acme_validation::run" })] })),
    /unsupported operation form 'guess'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({
        form: "call",
        path: "acme_validation::run",
        trailingArguments: [{ kind: "string", value: true }],
      })],
    })),
    /must contain a string/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({
        form: "call",
        path: "acme_validation::run",
        trailingArguments: [{ kind: "boolean", value: "true" }],
      })],
    })),
    /must contain a boolean/u,
  );
  assert.doesNotThrow(() => createRustProviderPackage(definition({
    operations: [operation({
      form: "call",
      path: "acme_validation::run",
      trailingArguments: [{ kind: "float64", value: 0 }],
    })],
  })));
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => createRustProviderPackage(definition({
        operations: [operation({
          form: "call",
          path: "acme_validation::run",
          trailingArguments: [{ kind: "float64", value }],
        })],
      })),
      /non-finite number/u,
    );
  }
});

test("generic value-slice forms require closed leading and element carriers", () => {
  const exported = functionExport("@acme/validation");
  exported.signatures[0].parameters = [{ name: "leading", type: { kind: "number" } }];
  const withOperations = (operations) => definition({
    modules: [{ moduleSpecifier: "@acme/validation", providerModuleId: "acme.validation", exports: [exported] }],
    operations,
  });
  const operation = (target) => ({
    exportId: "@acme/validation::run",
    operationKind: "method",
    target,
    resultCarrier: int32Carrier,
  });
  const base = {
    form: "call-value-slice",
    path: "acme_validation::run",
    leadingArguments: [{ carrier: int32Carrier, mode: "value" }],
    elementCarrier: int32Carrier,
  };

  assert.doesNotThrow(() => createRustProviderPackage(withOperations([operation(base)])));
  assert.throws(
    () => createRustProviderPackage(withOperations([
      operation({ ...base, leadingArguments: [{ carrier: int32Carrier, mode: "guess" }] }),
    ])),
    /unsupported mode 'guess'/u,
  );
  assert.throws(
    () => createRustProviderPackage(withOperations([
      operation({ ...base, elementCarrier: { kind: "target-named", id: "acme.Missing" } }),
    ])),
    /without a Rust carrier path/u,
  );
  assert.throws(
    () => createRustProviderPackage(withOperations([
      operation({ ...base, leadingArguments: [{ carrier: int32Carrier, mode: "value", fallback: true }] }),
    ])),
    /unsupported field 'fallback'/u,
  );
});

test("generic value-array forms require closed paths and element carriers", () => {
  const operation = (target) => ({
    exportId: "@acme/validation::run",
    operationKind: "method",
    target,
    resultCarrier: int32Carrier,
  });
  const base = {
    form: "call-value-array",
    path: "acme_validation::collect",
    leadingArguments: [],
    elementCarrier: int32Carrier,
  };

  assert.doesNotThrow(() => createRustProviderPackage(definition({ operations: [operation(base)] })));
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, path: "not-a-path" })],
    })),
    /not a closed Rust path/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, elementCarrier: { kind: "target-named", id: "acme.Missing" } })],
    })),
    /without a Rust carrier path/u,
  );
});

test("tagged-array forms require unique exact alternatives and closed constructors", () => {
  const typeArgument = { kind: "type", type: int32Carrier };
  const arrayCarrier = {
    kind: "target-named",
    id: "rust.js.JsArray",
    genericArguments: [typeArgument],
  };
  const taggedCarrier = {
    kind: "target-named",
    id: "rust.js.JsArrayConcatItem",
    genericArguments: [typeArgument],
  };
  const operation = (target) => ({
    exportId: "@acme/validation::run",
    operationKind: "method",
    target,
    resultCarrier: arrayCarrier,
  });
  const alternative = {
    inputCarrier: int32Carrier,
    mode: "value",
    constructorPath: "acme_validation::Tagged::Value",
  };
  const base = {
    form: "receiver-tagged-array",
    name: "concat",
    receiverMode: "ref",
    leadingArguments: [],
    elementCarrier: taggedCarrier,
    alternatives: [alternative],
  };

  assert.doesNotThrow(() => createRustProviderPackage(definition({ operations: [operation(base)] })));
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, alternatives: [alternative, alternative] })],
    })),
    /unique exact alternatives/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, alternatives: [{ ...alternative, constructorPath: "not-a-path" }] })],
    })),
    /not a closed Rust path/u,
  );
});

test("receiver string-slice forms require an exact path and receiver mode", () => {
  const operation = (target) => ({
    exportId: "@acme/validation::run",
    operationKind: "method",
    target,
    resultCarrier: int32Carrier,
  });
  const base = {
    form: "free-call-str-slice",
    path: "acme_validation::concat",
    receiverMode: "ref",
  };

  assert.doesNotThrow(() => createRustProviderPackage(definition({ operations: [operation(base)] })));
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, receiverMode: "guess" })],
    })),
    /unsupported mode 'guess'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, path: "not-a-path" })],
    })),
    /not a closed Rust path/u,
  );
});

test("owned receiver value-array forms require exact method, receiver, and carrier metadata", () => {
  const operation = (target) => ({
    exportId: "@acme/validation::run",
    operationKind: "method",
    target,
    resultCarrier: int32Carrier,
  });
  const base = {
    form: "receiver-value-array",
    name: "append_many",
    receiverMode: "ref",
    leadingArguments: [],
    elementCarrier: int32Carrier,
  };

  assert.doesNotThrow(() => createRustProviderPackage(definition({ operations: [operation(base)] })));
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, receiverMode: "guess" })],
    })),
    /unsupported mode 'guess'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, name: "append-many" })],
    })),
    /not a Rust identifier/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [operation({ ...base, fallback: true })],
    })),
    /unsupported field 'fallback'/u,
  );
});

test("provider crate registry replacement is explicit and schema-closed", () => {
  const accepted = createRustProviderPackage(definition({
    crates: [{
      crateName: "acme_validation",
      cargoPath: "/packages/acme_validation",
      registryPatch: "crates-io",
    }],
  }));
  const [reference] = accepted.runtimeContributions({}).references;
  assert.deepEqual(reference.attributes, {
    crate: "acme_validation",
    registryPatch: "crates-io",
  });

  assert.throws(
    () => createRustProviderPackage(definition({
      crates: [{
        crateName: "acme_validation",
        cargoPath: "/packages/acme_validation",
        registryPatch: "private-registry",
      }],
    })),
    /unsupported registry patch 'private-registry'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      crates: [{
        crateName: "acme_validation",
        cargoPath: "/packages/acme_validation",
        registryPatch: "crates-io",
        fallbackPath: "/tmp/acme_validation",
      }],
    })),
    /unsupported field 'fallbackPath'/u,
  );
});

test("provider packages retain an immutable validated metadata snapshot", () => {
  const input = definition();
  const providerPackage = createRustProviderPackage(input);
  input.operations[0].target.path = "mutated::after_validation";
  input.modules[0].exports[0].name = "mutated";

  const [contribution] = providerPackage.createTargetContributions({});
  assert.equal(contribution.definition.operations[0].target.path, "acme_validation::run");
  assert.equal(contribution.definition.modules[0].exports[0].name, "run");
  assert.equal(Object.isFrozen(contribution), true);
  assert.equal(Object.isFrozen(contribution.definition), true);
  assert.equal(Object.isFrozen(contribution.definition.operations), true);
});

test("provider operation contributions are revalidated with exact owner identity", () => {
  const providerPackage = createRustProviderPackage(definition());
  const [contribution] = providerPackage.createTargetContributions({});
  assert.throws(
    () => collectRustProviderOperationRows(providerContext([{
      ...providerPackage,
      createTargetContributions: () => [{ ...contribution, contractVersion: 2 }],
    }])),
    /invalid 'rust-provider-policy' contract/u,
  );
  assert.throws(
    () => collectRustProviderOperationRows(providerContext([{
      ...providerPackage,
      id: "other-owner",
    }])),
    /contributed provider metadata owned by 'acme-validation'/u,
  );
});

test("provider module identities are unique within one provider owner", () => {
  const [first] = definition().modules;
  const second = { ...first, moduleSpecifier: "@acme/validation/other" };
  assert.throws(
    () => createRustProviderPackage(definition({ modules: [first, second] })),
    /duplicate provider module id 'acme\.validation'/u,
  );
});

test("provider type relations remain target-owned and require closed Rust paths", () => {
  const valueExport = {
    id: "@acme/validation::Value",
    name: "Value",
    kind: "class",
    members: [],
  };
  const valid = definition({
    modules: [{
      moduleSpecifier: "@acme/validation",
      providerModuleId: "acme.validation",
      exports: [valueExport],
    }],
    types: [{ exportId: "@acme/validation::Value", targetCarrier: { kind: "target-named", id: "acme.validation.Value" } }],
    operations: [],
    carrierPaths: { "acme.validation.Value": "acme_validation::Value" },
  });
  const providerPackage = createRustProviderPackage(valid);
  const provider = createRustProviderPackageSourceProvider(valid);
  const model = provider.getDeclarationModel({
    moduleSpecifier: "@acme/validation",
    providerModuleId: "acme.validation",
  });
  assert.deepEqual(model.exports, [valueExport]);
  assert.equal(Object.hasOwn(model.exports[0], "targetIdentity"), false);
  assert.deepEqual(collectRustProviderSemantics(providerContext([providerPackage])).types, [{
    exportId: "@acme/validation::Value",
    targetCarrier: {
      kind: "target-specific",
      target: "rust",
      name: "named-type",
      value: {
        id: "acme.validation.Value",
        path: "acme_validation::Value",
        traits: { implementations: [] },
        genericArguments: [],
      },
    },
    providerPackageId: "acme-validation",
    providerId: "tsonic.rust.provider-package.acme-validation.binding",
    providerVersion: "1.0.0",
    providerModuleId: "acme.validation",
    moduleSpecifier: "@acme/validation",
  }]);

  assert.throws(
    () => createRustProviderPackage({
      ...valid,
      types: [{ exportId: "@acme/validation::Value", targetCarrier: { kind: "target-named", id: "acme.validation.Value" }, target: "csharp" }],
    }),
    /type relation has unsupported field 'target'/u,
  );
  assert.throws(
    () => createRustProviderPackage({ ...valid, carrierPaths: {} }),
    /target type 'acme\.validation\.Value' has no closed Rust carrier path/u,
  );
  assert.throws(
    () => createRustProviderPackage({
      ...valid,
      carrierTraits: {
        "acme.validation.Missing": {
          implementations: [{ traitPath: "core::clone::Clone", requirements: [] }],
        },
      },
    }),
    /carrier trait contract 'acme\.validation\.Missing' has no rendered carrier path/u,
  );
  assert.throws(
    () => createRustProviderPackage({
      ...valid,
      carrierTraits: {
        "acme.validation.Value": {
          implementations: [{ traitPath: "core::marker::Copy", requirements: [] }],
        },
      },
    }),
    /invalid native trait contract/u,
  );
  assert.throws(
    () => createRustProviderPackage({ ...definition(), targetIdentities: { "@acme/validation::Value": "acme.validation.Value" } }),
    /unsupported field 'targetIdentities'/u,
  );
});

test("module ownership and declaration rendering retain exact provider identity", () => {
  const providerPackage = createRustProviderPackage(definition());
  assert.deepEqual(providerPackage.moduleOwnership, [{
    specifierPrefix: "@acme/validation",
    providerId: "tsonic.rust.provider-package.acme-validation.binding",
  }]);
  const provider = createRustProviderPackageSourceProvider(definition());
  assert.throws(
    () => provider.getDeclarationModel({
      moduleSpecifier: "@acme/other",
      providerModuleId: "acme.other",
    }),
    /cannot render unowned module '@acme\/other'/u,
  );
  assert.throws(
    () => provider.getDeclarationModel({
      moduleSpecifier: "@acme/validation",
      providerModuleId: "acme.wrong",
    }),
    /resolved with provider module id 'acme\.wrong', expected 'acme\.validation'/u,
  );
  const [row] = collectRustProviderOperationRows(providerContext([providerPackage]));
  assert.deepEqual({
    providerPackageId: row.providerPackageId,
    providerId: row.providerId,
    providerVersion: row.providerVersion,
    providerModuleId: row.providerModuleId,
    moduleSpecifier: row.moduleSpecifier,
  }, {
    providerPackageId: "acme-validation",
    providerId: "tsonic.rust.provider-package.acme-validation.binding",
    providerVersion: "1.0.0",
    providerModuleId: "acme.validation",
    moduleSpecifier: "@acme/validation",
  });
});

test("provider module aliases retain one canonical provider identity", () => {
  const canonicalModuleSpecifier = "@acme/validation";
  const aliasModuleSpecifier = "acme-validation";
  const valueExport = {
    id: `${canonicalModuleSpecifier}::Value`,
    name: "Value",
    kind: "class",
    members: [{
      id: `${canonicalModuleSpecifier}::Value.next`,
      name: "next",
      kind: "property",
      readonly: true,
      type: {
        kind: "provider-ref",
        moduleSpecifier: canonicalModuleSpecifier,
        exportName: "Value",
      },
    }],
  };
  const aliased = definition({
    moduleAliases: [{ moduleSpecifier: aliasModuleSpecifier, canonicalModuleSpecifier }],
    modules: [{
      moduleSpecifier: canonicalModuleSpecifier,
      providerModuleId: "acme.validation",
      exports: [valueExport],
    }],
    operations: [],
  });
  const providerPackage = createRustProviderPackage(aliased);
  assert.deepEqual(providerPackage.moduleOwnership, [
    {
      specifierPrefix: canonicalModuleSpecifier,
      providerId: "tsonic.rust.provider-package.acme-validation.binding",
    },
    {
      specifierPrefix: aliasModuleSpecifier,
      providerId: "tsonic.rust.provider-package.acme-validation.binding",
    },
  ]);

  const provider = createRustProviderPackageSourceProvider(aliased);
  assert.deepEqual(provider.ownsModule(aliasModuleSpecifier), { kind: "owned" });
  const resolution = provider.resolveModule(aliasModuleSpecifier);
  assert.equal(resolution.kind, "virtual");
  assert.equal(resolution.moduleSpecifier, aliasModuleSpecifier);
  assert.equal(resolution.providerModuleId, "acme.validation");
  const model = provider.getDeclarationModel(resolution);
  assert.equal(model.moduleSpecifier, aliasModuleSpecifier);
  assert.equal(model.providerModuleId, "acme.validation");
  assert.deepEqual(model.exports[0].members[0].type, {
    kind: "provider-ref",
    moduleSpecifier: aliasModuleSpecifier,
    exportName: "Value",
  });

  for (const invalid of [
    {
      moduleAliases: [{ moduleSpecifier: "missing", canonicalModuleSpecifier: "@acme/missing" }],
      pattern: /names unknown canonical module '@acme\/missing'/u,
    },
    {
      moduleAliases: [{ moduleSpecifier: canonicalModuleSpecifier, canonicalModuleSpecifier }],
      pattern: /conflicts with a declared module or source dependency/u,
    },
    {
      moduleAliases: [
        { moduleSpecifier: aliasModuleSpecifier, canonicalModuleSpecifier },
        { moduleSpecifier: aliasModuleSpecifier, canonicalModuleSpecifier },
      ],
      pattern: /duplicate module alias 'acme-validation'/u,
    },
  ]) {
    assert.throws(
      () => createRustProviderPackage(definition({ moduleAliases: invalid.moduleAliases })),
      invalid.pattern,
    );
  }
});

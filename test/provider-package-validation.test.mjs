import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectRustProviderOperationRows,
  collectRustProviderSemantics,
  createRustProviderPackage,
  createRustProviderPackageSourceProvider,
  rustInt32ToFloat64ValueConversion,
} from "../dist/index.js";

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
  return {
    project: { entryPoint: "src/index.ts", targets: [{ id: "rust" }] },
    projectDirectory: "/src",
    target: { id: "rust", options: {} },
    targetPack: { id: "rust" },
    selectedCapabilities,
    selectedSurfaces: [],
  };
}

test("provider operation metadata accepts only structured Rust forms", () => {
  const invalidTargets = [
    {
      label: "legacy trailing source",
      target: { form: "call", path: "acme_validation::run", trailingArgs: ["None"] },
      pattern: /unsupported field 'trailingArgs'/u,
    },
    {
      label: "raw cast source",
      target: { form: "call", path: "acme_validation::run", argCasts: ["i32"] },
      pattern: /unsupported field 'argCasts'/u,
    },
    {
      label: "raw chain source",
      target: { form: "call", path: "acme_validation::run", chain: ["to_string"] },
      pattern: /must be a structured provider chain step/u,
    },
    {
      label: "Rust source injection",
      target: { form: "call", path: "acme_validation::run(); panic!()" },
      pattern: /not a closed Rust path/u,
    },
    {
      label: "extra target field",
      target: { form: "call", path: "acme_validation::run", fallback: "guess" },
      pattern: /unsupported field 'fallback'/u,
    },
  ];

  for (const item of invalidTargets) {
    assert.throws(
      () => createRustProviderPackage(definition({
        operations: [{
          exportId: "@acme/validation::run",
          operationKind: "method",
          target: item.target,
          resultCarrier: int32Carrier,
        }],
      })),
      item.pattern,
      item.label,
    );
  }
});

test("provider operation metadata rejects unknown and missing operation kinds", () => {
  for (const operationKind of [undefined, "call", "guess"]) {
    assert.throws(
      () => createRustProviderPackage(definition({
        operations: [{
          exportId: "@acme/validation::run",
          ...(operationKind === undefined ? {} : { operationKind }),
          target: { form: "call", path: "acme_validation::run" },
          resultCarrier: int32Carrier,
        }],
      })),
      /unsupported operation kind/u,
    );
  }
});

test("provider declaration variants reject runtime-only extra fields", () => {
  const invalidTypes = [
    { type: { kind: "string", sourceShape: { kind: "string" } }, pattern: /unsupported field 'sourceShape'/u },
    { type: { kind: "array", elementType: { kind: "number" }, sourceShape: { kind: "array", elementType: { kind: "number" } } }, pattern: /unsupported field 'sourceShape'/u },
    { type: { kind: "source-primitive", name: "int32", rustName: "i32" }, pattern: /unsupported field 'rustName'/u },
    { type: { kind: "object", members: [] }, pattern: /unsupported field 'members'/u },
  ];
  for (const { type, pattern } of invalidTypes) {
    const exported = functionExport("@acme/validation");
    exported.signatures[0].returnType = type;
    assert.throws(
      () => createRustProviderPackage(definition({
        modules: [{ moduleSpecifier: "@acme/validation", providerModuleId: "acme.validation", exports: [exported] }],
      })),
      pattern,
    );
  }
});

test("provider declaration records reject unknown fields and passing modes", () => {
  const extraSignature = functionExport("@acme/validation");
  extraSignature.signatures[0].fallback = "guess";
  assert.throws(
    () => createRustProviderPackage(definition({
      modules: [{ moduleSpecifier: "@acme/validation", providerModuleId: "acme.validation", exports: [extraSignature] }],
    })),
    /signature .* unsupported field 'fallback'/u,
  );

  const invalidParameter = functionExport("@acme/validation");
  invalidParameter.signatures[0].parameters = [{ name: "value", type: { kind: "number" }, passingMode: "guess" }];
  assert.throws(
    () => createRustProviderPackage(definition({
      modules: [{ moduleSpecifier: "@acme/validation", providerModuleId: "acme.validation", exports: [invalidParameter] }],
    })),
    /unsupported passing mode 'guess'/u,
  );
});

test("provider packages reject unresolved carrier-dependent chain placeholders", () => {
  assert.throws(() => createRustProviderPackage(definition({
    operations: [{
      exportId: "@acme/validation::run",
      operationKind: "method",
      target: {
        form: "call",
        path: "acme_validation::run",
        chain: [{ kind: "copy-selected-carrier" }],
      },
      resultCarrier: int32Carrier,
    }],
  })), /operation chains must contain only concrete zero-argument method steps/u);
});

test("provider operation rows cover every selected source parameter exactly", () => {
  const exported = functionExport("@acme/validation");
  exported.signatures[0].parameters = [{ name: "value", type: { kind: "number" } }];
  assert.throws(
    () => createRustProviderPackage(definition({
      modules: [{ moduleSpecifier: "@acme/validation", providerModuleId: "acme.validation", exports: [exported] }],
    })),
    /declares 0 target parameter carriers for 1 selected source parameters/u,
  );
});

test("provider operation carriers are closed and renderable", () => {
  const invalidCarriers = [
    {
      label: "unregistered target carrier",
      carrier: { kind: "target-named", id: "acme.Missing" },
      pattern: /without a Rust carrier path/u,
    },
    {
      label: "extra carrier field",
      carrier: { kind: "source-primitive", name: "int32", rustName: "i32" },
      pattern: /unsupported field 'rustName'/u,
    },
    {
      label: "result conversion target mismatch",
      carrier: { kind: "array", element: int32Carrier },
      cast: true,
      pattern: /resultConversion\.target does not match the selected operation result carrier/u,
    },
    {
      label: "unsupported function-pointer carrier",
      carrier: { kind: "function-pointer", args: [], result: int32Carrier },
      pattern: /unsupported Rust carrier kind 'function-pointer'/u,
    },
  ];

  for (const item of invalidCarriers) {
    assert.throws(
      () => createRustProviderPackage(definition({
        operations: [{
          exportId: "@acme/validation::run",
          operationKind: "method",
          target: { form: "call", path: "acme_validation::run" },
          resultCarrier: item.cast === true ? int32Carrier : item.carrier,
          ...(item.cast === true ? { resultConversion: rustInt32ToFloat64ValueConversion } : {}),
        }],
      })),
      item.pattern,
      item.label,
    );
  }
});

test("provider value conversions use only target-owned semantic ids", () => {
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [{
        exportId: "@acme/validation::run",
        operationKind: "method",
        target: { form: "call", path: "acme_validation::run" },
        resultCarrier: int32Carrier,
        resultConversion: { kind: "semantic-conversion", id: "acme-custom-cast" },
      }],
    })),
    /not a supported Rust value conversion/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [{
        exportId: "@acme/validation::run",
        operationKind: "method",
        target: { form: "call", path: "acme_validation::run" },
        resultCarrier: int32Carrier,
        resultConversion: {
          kind: "semantic-conversion",
          id: "exact-i32-to-f64",
          path: "acme_validation::guess",
        },
      }],
    })),
    /unsupported field 'path'/u,
  );
});

test("provider selector identities remain within their declaration owner", () => {
  const modules = [{
    moduleSpecifier: "@acme/validation",
    providerModuleId: "acme.validation",
    exports: [
      {
        id: "acme.A",
        name: "A",
        kind: "class",
        members: [{
          id: "acme.A.run",
          name: "run",
          kind: "method",
          signatures: [{ id: "acme.A.run()", parameters: [], returnType: { kind: "void" } }],
        }],
      },
      {
        id: "acme.B",
        name: "B",
        kind: "class",
        members: [{
          id: "acme.B.run",
          name: "run",
          kind: "method",
          signatures: [{ id: "acme.B.run()", parameters: [], returnType: { kind: "void" } }],
        }],
      },
    ],
  }];

  assert.throws(
    () => createRustProviderPackage(definition({
      modules,
      operations: [{
        exportId: "acme.A",
        memberId: "acme.B.run",
        operationKind: "method",
        target: { form: "receiver-method", name: "run" },
        resultCarrier: int32Carrier,
      }],
    })),
    /outside export 'acme.A'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      modules,
      operations: [{
        exportId: "acme.A",
        memberId: "acme.A.run",
        signatureId: "acme.B.run()",
        operationKind: "method",
        target: { form: "receiver-method", name: "run" },
        resultCarrier: int32Carrier,
      }],
    })),
    /outside its selected declaration/u,
  );
});

test("cross-module provider refs require an explicit declared import", () => {
  const referenced = {
    id: "@acme/types::Value",
    name: "Value",
    kind: "interface",
  };
  const consumer = {
    id: "@acme/consumer::read",
    name: "read",
    kind: "function",
    signatures: [{
      id: "@acme/consumer::read()",
      parameters: [],
      returnType: { kind: "provider-ref", moduleSpecifier: "@acme/types", exportName: "Value" },
    }],
  };
  const modules = [
    { moduleSpecifier: "@acme/types", providerModuleId: "acme.types", exports: [referenced] },
    { moduleSpecifier: "@acme/consumer", providerModuleId: "acme.consumer", exports: [consumer] },
  ];
  assert.throws(
    () => createRustProviderPackage(definition({ modules, operations: [] })),
    /without a matching declaration and import/u,
  );

  assert.doesNotThrow(() => createRustProviderPackage(definition({
    modules: [
      modules[0],
      {
        ...modules[1],
        imports: [{ moduleSpecifier: "@acme/types", namedImports: [{ exportedName: "Value" }] }],
      },
    ],
    operations: [],
  })));
});

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
    types: [{ exportId: "@acme/validation::Value", targetTypeId: "acme.validation.Value" }],
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
    targetTypeId: "acme.validation.Value",
    providerPackageId: "acme-validation",
    providerId: "tsonic.rust.provider-package.acme-validation.binding",
    providerVersion: "1.0.0",
    providerModuleId: "acme.validation",
    moduleSpecifier: "@acme/validation",
  }]);

  assert.throws(
    () => createRustProviderPackage({
      ...valid,
      types: [{ exportId: "@acme/validation::Value", targetTypeId: "acme.validation.Value", target: "csharp" }],
    }),
    /type relation has unsupported field 'target'/u,
  );
  assert.throws(
    () => createRustProviderPackage({ ...valid, carrierPaths: {} }),
    /target type 'acme\.validation\.Value' has no closed Rust carrier path/u,
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

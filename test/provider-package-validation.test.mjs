import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectRustProviderOperationRows,
  collectRustProviderSemantics,
  createRustProviderPackage,
  createRustProviderPackageSourceProvider,
  rustInt32ToFloat64ValueConversion,
  rustCallableTargetType,
  rustClosureTargetType,
} from "../dist/index.js";
import {
  collectRustProviderSemanticsFromDefinitions,
  mergeRustProviderSemantics,
} from "../dist/source/provider-packages/index.js";
import { rustNamedTypeCarrierValue } from "../dist/source/rust-target-types.js";

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

test("provider carriers distinguish owned vectors from nested unsized slices", () => {
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [{
        exportId: "@acme/validation::run",
        operationKind: "method",
        target: { form: "call", path: "acme_validation::run" },
        resultCarrier: { kind: "slice", element: int32Carrier },
      }],
    })),
    /bare Rust slice outside a reference, pointer, or target type argument/u,
  );

  assert.doesNotThrow(() => createRustProviderPackage(definition({
    carrierPaths: { "acme.Box": "alloc::boxed::Box" },
    operations: [{
      exportId: "@acme/validation::run",
      operationKind: "method",
      target: { form: "call", path: "acme_validation::run" },
      resultCarrier: {
        kind: "target-named",
        id: "acme.Box",
        typeArguments: [{ kind: "slice", element: int32Carrier }],
      },
    }],
  })));
});

test("provider carrier metadata canonicalizes after cross-provider composition", () => {
  const boxCarrier = { kind: "target-named", id: "acme.Box" };
  const carrierPaths = { "acme.Box": "alloc::boxed::Box" };
  const carrierTraits = {
    "acme.Box": {
      implementations: [{ traitPath: "core::clone::Clone", requirements: [] }],
    },
  };
  const owner = definition({
    id: "acme-carrier-owner",
    displayName: "Acme carrier owner",
    carrierPaths,
    carrierTraits,
    operations: [],
  });
  const consumer = definition({
    id: "acme-carrier-consumer",
    displayName: "Acme carrier consumer",
    carrierPaths,
    operations: [{
      exportId: "@acme/validation::run",
      operationKind: "method",
      target: { form: "call", path: "acme_validation::run" },
      resultCarrier: boxCarrier,
    }],
  });

  const together = collectRustProviderSemanticsFromDefinitions([consumer, owner]);
  const separately = mergeRustProviderSemantics(
    collectRustProviderSemanticsFromDefinitions([consumer]),
    collectRustProviderSemanticsFromDefinitions([owner]),
  );
  const togetherCarrier = rustNamedTypeCarrierValue(together.operations[0].resultCarrier);
  const separateCarrier = rustNamedTypeCarrierValue(separately.operations[0].resultCarrier);

  assert.deepEqual(togetherCarrier?.traits, carrierTraits["acme.Box"]);
  assert.deepEqual(separateCarrier, togetherCarrier);
});

test("runtime Callable is a built-in generic carrier and needs no provider-owned path", () => {
  const providerPackage = createRustProviderPackage(definition({
    operations: [{
      exportId: "@acme/validation::run",
      operationKind: "method",
      target: { form: "call", path: "acme_validation::run" },
      resultCarrier: rustCallableTargetType([], int32Carrier),
    }],
  }));
  const [contribution] = providerPackage.createTargetContributions({});
  assert.deepEqual(contribution.definition.operations[0].resultCarrier,
    rustCallableTargetType([], int32Carrier));
});

test("provider immediate-callback metadata declares one exact fallible target ABI", () => {
  const callbackCarrier = rustClosureTargetType([], { kind: "tuple", elements: [] });
  const callbackExport = {
    id: "@acme/validation::withCallback",
    name: "withCallback",
    kind: "function",
    signatures: [{
      id: "@acme/validation::withCallback(callback)",
      name: "withCallback",
      parameters: [{
        name: "callback",
        type: {
          kind: "function",
          id: "@acme/validation::withCallback.callback",
          parameters: [],
          returnType: { kind: "void" },
        },
      }],
      returnType: { kind: "void" },
    }],
  };
  const providerPackage = createRustProviderPackage(definition({
    modules: [{
      moduleSpecifier: "@acme/validation",
      providerModuleId: "acme.validation",
      exports: [callbackExport],
    }],
    operations: [{
      exportId: callbackExport.id,
      operationKind: "method",
      target: { form: "call", path: "acme_validation::with_callback" },
      resultCarrier: { kind: "tuple", elements: [] },
      parameterCarriers: [callbackCarrier],
      immediateCallback: {
        sourceArgumentIndex: 0,
        fallibleTarget: { form: "call", path: "acme_validation::with_fallible_callback" },
      },
    }],
  }));
  const [contribution] = providerPackage.createTargetContributions({});
  assert.deepEqual(contribution.definition.operations[0].immediateCallback, {
    sourceArgumentIndex: 0,
    fallibleTarget: { form: "call", path: "acme_validation::with_fallible_callback" },
  });
});

test("provider immediate-callback metadata fails closed on an inexact callback contract", () => {
  const cases = [
    {
      label: "missing callback parameter",
      parameterCarriers: [],
      immediateCallback: { sourceArgumentIndex: 0, fallibleTarget: { form: "call", path: "acme_validation::fallible" } },
      pattern: /must select one declared parameter carrier/u,
    },
    {
      label: "non-callable parameter",
      parameterCarriers: [int32Carrier],
      immediateCallback: { sourceArgumentIndex: 0, fallibleTarget: { form: "call", path: "acme_validation::fallible" } },
      pattern: /must select one exact native closure carrier/u,
    },
    {
      label: "retained callable cannot use immediate metadata",
      parameterCarriers: [rustCallableTargetType([], int32Carrier)],
      immediateCallback: { sourceArgumentIndex: 0, fallibleTarget: { form: "call", path: "acme_validation::fallible" } },
      pattern: /must select one exact native closure carrier/u,
    },
    {
      label: "unknown callback field",
      parameterCarriers: [rustClosureTargetType([], int32Carrier)],
      immediateCallback: { sourceArgumentIndex: 0, fallibleTarget: { form: "call", path: "acme_validation::fallible" }, fallback: true },
      pattern: /unsupported field 'fallback'/u,
    },
    {
      label: "raw fallible target",
      parameterCarriers: [rustClosureTargetType([], int32Carrier)],
      immediateCallback: { sourceArgumentIndex: 0, fallibleTarget: { form: "call", path: "acme_validation::fallible\(\)" } },
      pattern: /not a closed Rust path/u,
    },
  ];
  for (const item of cases) {
    assert.throws(
      () => createRustProviderPackage(definition({
        operations: [{
          exportId: "@acme/validation::run",
          operationKind: "method",
          target: { form: "call", path: "acme_validation::run" },
          resultCarrier: int32Carrier,
          parameterCarriers: item.parameterCarriers,
          immediateCallback: item.immediateCallback,
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

test("external source dependencies declare exact provider-reference imports", () => {
  const externalType = {
    kind: "provider-ref",
    moduleSpecifier: "@external/types",
    exportName: "External",
  };
  const exported = functionExport("@acme/validation");
  exported.signatures[0].returnType = externalType;
  const modules = [{
    moduleSpecifier: "@acme/validation",
    providerModuleId: "acme.validation",
    imports: [{
      moduleSpecifier: "@external/types",
      namedImports: [{ exportedName: "External" }],
    }],
    exports: [exported],
  }];
  const sourceDependencies = [{
    moduleSpecifier: "@external/types",
    exportedNames: ["External"],
  }];

  assert.doesNotThrow(() => createRustProviderPackage(definition({
    sourceDependencies,
    modules,
  })));
  assert.throws(
    () => createRustProviderPackage(definition({ modules })),
    /imports from undeclared module '@external\/types'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      sourceDependencies: [{ moduleSpecifier: "@external/types", exportedNames: ["Other"] }],
      modules,
    })),
    /imports undeclared export 'External'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      sourceDependencies: [sourceDependencies[0], sourceDependencies[0]],
      modules,
    })),
    /duplicate source dependency module '@external\/types'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      sourceDependencies: [{ moduleSpecifier: "@external/types", exportedNames: ["External", "External"] }],
      modules,
    })),
    /repeats export 'External'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      sourceDependencies: [{ moduleSpecifier: "@external/types", exportedNames: [] }],
      modules,
    })),
    /must declare at least one export/u,
  );
});

test("operation type parameters are declared exactly when their carriers use them", () => {
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [{
        exportId: "@acme/validation::run",
        operationKind: "method",
        target: { form: "call", path: "acme_validation::run" },
        resultCarrier: { kind: "type-parameter", name: "T" },
      }],
    })),
    /references undeclared operation type parameter 'T'/u,
  );
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [{
        exportId: "@acme/validation::run",
        operationKind: "method",
        target: { form: "call", path: "acme_validation::run" },
        resultCarrier: int32Carrier,
        typeParameters: ["T"],
      }],
    })),
    /declares unused operation type parameter 'T'/u,
  );
  assert.doesNotThrow(() => createRustProviderPackage(definition({
    operations: [{
      exportId: "@acme/validation::run",
      operationKind: "method",
      target: { form: "call", path: "acme_validation::run" },
      resultCarrier: { kind: "type-parameter", name: "T" },
      typeParameters: ["T"],
    }],
  })));
  assert.doesNotThrow(() => createRustProviderPackage(definition({
    operations: [{
      exportId: "@acme/validation::run",
      operationKind: "method",
      target: { form: "call", path: "acme_validation::run" },
      resultCarrier: int32Carrier,
      typeParameters: ["T"],
      targetTypeArguments: [{ kind: "type-parameter", name: "T" }],
    }],
  })));
  assert.throws(
    () => createRustProviderPackage(definition({
      operations: [{
        exportId: "@acme/validation::run",
        operationKind: "method",
        target: { form: "path", path: "acme_validation::VALUE" },
        resultCarrier: int32Carrier,
        typeParameters: ["T"],
        targetTypeArguments: [{ kind: "type-parameter", name: "T" }],
      }],
    })),
    /targetTypeArguments requires a non-empty native call or method/u,
  );
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
  const arrayCarrier = { kind: "target-named", id: "rust.js.JsArray", typeArguments: [int32Carrier] };
  const taggedCarrier = { kind: "target-named", id: "rust.js.JsArrayConcatItem", typeArguments: [int32Carrier] };
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
        typeArguments: [],
      },
    },
    providerPackageId: "acme-validation",
    providerId: "tsonic.rust.provider-package.acme-validation.binding",
    providerVersion: "1.0.0",
    providerModuleId: "acme.validation",
    moduleSpecifier: "@acme/validation",
    sourceTypeParameters: [],
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

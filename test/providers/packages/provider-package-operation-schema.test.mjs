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
import { rustNamedTypeCarrierValue } from "../../../dist/policy/types/target-types.js";
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

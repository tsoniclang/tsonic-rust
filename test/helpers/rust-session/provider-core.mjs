import {
  createRustProviderPackage,
  emptyRustGenerics,
  rustNeverTargetType,
  rustProviderPathTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
} from "../../../dist/public/provider.js";
import { fixtureCratesRoot } from "./paths.mjs";
import { resolve } from "node:path";

export const stringCarrier = rustStringTargetType();
export const unitCarrier = rustUnitTargetType();
export const int32Carrier = rustSourcePrimitiveTargetType("int32");
export const boolCarrier = rustSourcePrimitiveTargetType("bool");
export const neverCarrier = rustNeverTargetType();
export const storeCarrier = rustProviderPathTargetType({
  owner: {
    packageId: "acme-platform",
    packageVersion: "1.0.0",
    compilationSnapshotId: "acme-platform@1.0.0",
  },
  itemId: "acme.platform.Store",
  displayPath: "acme_platform::Store",
});

export function acmeFilesPackage({ binaryEpilogues } = {}) {
  return createRustProviderPackage({
    id: "acme-files",
    displayName: "Acme files",
    version: "1.0.0",
    compilationSnapshotId: "acme-files@1.0.0",
    modules: [{
      moduleSpecifier: "@acme/files",
      providerModuleId: "acme.files",
      exports: [{
        id: "@acme/files::readText",
        name: "readText",
        kind: "function",
        signatures: [{
          id: "@acme/files::readText(path)",
          name: "readText",
          parameters: [{ name: "path", type: { kind: "string" } }],
          returnType: { kind: "string" },
        }],
      }],
    }],
    operations: [{
      exportId: "@acme/files::readText",
      operationKind: "method",
      target: { form: "call", path: "acme_files::read_text" },
      resultCarrier: stringCarrier,
      parameterCarriers: [stringCarrier],
    }],
    ...(binaryEpilogues === undefined ? {} : { binaryEpilogues }),
    crates: [{ crateName: "acme_files", cargoPath: resolve(fixtureCratesRoot, "acme_files") }],
  });
}
export function acmeTestingPackage() {
  return createRustProviderPackage({
    id: "acme-testing",
    displayName: "Acme testing",
    version: "1.0.0",
    compilationSnapshotId: "acme-testing@1.0.0",
    modules: [{
      moduleSpecifier: "@acme/testing",
      providerModuleId: "acme.testing",
      exports: [
        {
          id: "@acme/testing::check",
          name: "check",
          kind: "function",
          signatures: [{
            id: "@acme/testing::check(condition)",
            name: "check",
            parameters: [{ name: "condition", type: { kind: "boolean" } }],
            returnType: { kind: "void" },
          }],
        },
        {
          id: "@acme/testing::fail",
          name: "fail",
          kind: "function",
          signatures: [{
            id: "@acme/testing::fail(message)",
            name: "fail",
            parameters: [{ name: "message", type: { kind: "string" } }],
            returnType: { kind: "never" },
          }],
        },
      ],
    }],
    operations: [
      {
        exportId: "@acme/testing::check",
        operationKind: "method",
        target: { form: "call", path: "acme_testing::check" },
        resultCarrier: unitCarrier,
        parameterCarriers: [boolCarrier],
      },
      {
        exportId: "@acme/testing::fail",
        operationKind: "method",
        target: { form: "call", path: "acme_testing::fail" },
        resultCarrier: neverCarrier,
        parameterCarriers: [stringCarrier],
      },
    ],
    crates: [{ crateName: "acme_testing", cargoPath: resolve(fixtureCratesRoot, "acme_testing") }],
  });
}

export function acmePlatformPackage({ includeHomeDir = true, includeSetters = false, binaryEpilogues } = {}) {
  return createRustProviderPackage({
    id: "acme-platform",
    displayName: "Acme platform",
    version: "1.0.0",
    compilationSnapshotId: "acme-platform@1.0.0",
    modules: [{
      moduleSpecifier: "@acme/platform",
      providerModuleId: "acme.platform",
      exports: [
        {
          id: "@acme/platform::Env",
          name: "Env",
          kind: "class",
          members: [
            { id: "@acme/platform::Env.homeDir", name: "homeDir", kind: "property", static: true, readonly: true, type: { kind: "string" } },
          ],
        },
        {
          id: "@acme/platform::Store",
          name: "Store",
          kind: "class",
          members: [
            {
              id: "@acme/platform::Store.constructor",
              name: "constructor",
              kind: "constructor",
              signatures: [{ id: "@acme/platform::Store.constructor(seed)", parameters: [{ name: "seed", type: { kind: "string" } }] }],
            },
            { id: "@acme/platform::Store.count", name: "count", kind: "property", type: { kind: "source-primitive", name: "int32" } },
            {
              id: "@acme/platform::Store.indexer",
              name: "indexer",
              kind: "indexer",
              signatures: [{
                id: "@acme/platform::Store.indexer(index)",
                parameters: [{ name: "index", type: { kind: "source-primitive", name: "int32" } }],
                returnType: { kind: "source-primitive", name: "int32" },
              }],
            },
          ],
        },
      ],
    }],
    types: [{
      exportId: "@acme/platform::Store",
      targetDeclarationKind: "struct",
      sourceGenericBindings: [],
      targetGenerics: emptyRustGenerics,
      targetCarrier: storeCarrier,
    }],
    operations: [
      {
        exportId: "@acme/platform::Env",
        memberId: "@acme/platform::Env.homeDir",
        operationKind: "property",
        target: { form: "call", path: "acme_platform::env_home_dir" },
        resultCarrier: stringCarrier,
      },
      {
        exportId: "@acme/platform::Store",
        memberId: "@acme/platform::Store.constructor",
        operationKind: "constructor",
        target: { form: "call", path: "acme_platform::Store::new" },
        resultCarrier: storeCarrier,
        parameterCarriers: [stringCarrier],
      },
      {
        exportId: "@acme/platform::Store",
        memberId: "@acme/platform::Store.count",
        operationKind: "property",
        target: { form: "field", name: "count" },
        resultCarrier: int32Carrier,
      },
      {
        exportId: "@acme/platform::Store",
        memberId: "@acme/platform::Store.indexer",
        operationKind: "indexer",
        target: { form: "method", name: "get" },
        resultCarrier: int32Carrier,
        parameterCarriers: [int32Carrier],
      },
      ...(includeSetters
        ? [
            {
              exportId: "@acme/platform::Store",
              memberId: "@acme/platform::Store.count",
              operationKind: "property-set",
              target: { form: "receiver-method", name: "set_count" },
              resultCarrier: unitCarrier,
              parameterCarriers: [int32Carrier],
            },
            {
              exportId: "@acme/platform::Store",
              memberId: "@acme/platform::Store.indexer",
              signatureId: "@acme/platform::Store.indexer(index)",
              operationKind: "index-set",
              target: { form: "receiver-method", name: "set" },
              resultCarrier: unitCarrier,
              parameterCarriers: [int32Carrier, int32Carrier],
            },
          ]
        : []),
    ].filter((row) => includeHomeDir || row.memberId !== "@acme/platform::Env.homeDir"),
    ...(binaryEpilogues === undefined ? {} : { binaryEpilogues }),
    crates: [{ crateName: "acme_platform", cargoPath: resolve(fixtureCratesRoot, "acme_platform") }],
  });
}

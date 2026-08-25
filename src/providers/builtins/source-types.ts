import {
  tsonicCoreNativePointerProviderNames,
  tsonicCoreProviderVersion,
  tsonicCoreTypesModule,
  tsonicCoreVirtualModulesProviderId,
} from "@tsonic/source-core/facts";
import {
  rustConstPointerExport,
  rustMutPointerExport,
  rustSourceProviderVersion,
  rustSourceVirtualModulesProviderId,
} from "../../source/extension/source-extension.js";
import { rustTypesModule } from "../../source/profiles/source-modules.js";
import type {
  RustProviderSemantics,
  RustProviderTypeRow,
} from "../packages/model.js";
import {
  rustRawPointerTargetType,
  rustTypeParameterTargetType,
} from "../../target-model/types/constructors.js";

const nativePointerType = pointerType(
  "tsonic-source-core",
  tsonicCoreVirtualModulesProviderId,
  tsonicCoreProviderVersion,
  tsonicCoreTypesModule,
  tsonicCoreNativePointerProviderNames.nativePointerExport,
  "mut",
);

const rustConstPointerType = pointerType(
  "tsonic-rust-source",
  rustSourceVirtualModulesProviderId,
  rustSourceProviderVersion,
  rustTypesModule,
  rustConstPointerExport,
  "const",
);

const rustMutPointerType = pointerType(
  "tsonic-rust-source",
  rustSourceVirtualModulesProviderId,
  rustSourceProviderVersion,
  rustTypesModule,
  rustMutPointerExport,
  "mut",
);

export function rustBuiltInSourceTypeSemantics(): RustProviderSemantics {
  return Object.freeze({
    exports: Object.freeze([]),
    operations: Object.freeze([]),
    carrierPaths: Object.freeze({}),
    carrierTraits: Object.freeze({}),
    binaryEpilogues: Object.freeze([]),
    types: Object.freeze([
      nativePointerType,
      rustConstPointerType,
      rustMutPointerType,
    ]),
  });
}

function pointerType(
  providerPackageId: string,
  providerId: string,
  providerVersion: string,
  moduleSpecifier: string,
  exportId: string,
  mutability: "const" | "mut",
): RustProviderTypeRow {
  const parameterIdentity = Object.freeze({
    kind: "provider" as const,
    providerId,
    providerVersion,
    compilationSnapshotId: `${providerId}@${providerVersion}`,
    itemId: `${moduleSpecifier}:${exportId}:type-parameter:T`,
  });
  const parameterType = rustTypeParameterTargetType(parameterIdentity, "T");
  return Object.freeze({
    exportId,
    targetDeclarationKind: "type-alias",
    targetCarrier: rustRawPointerTargetType(
      parameterType,
      mutability === "mut",
    ),
    providerPackageId,
    providerId,
    providerVersion,
    providerModuleId: moduleSpecifier,
    moduleSpecifier,
    sourceGenericBindings: Object.freeze([Object.freeze({
      sourceName: "T",
      target: Object.freeze({
        kind: "generic-parameter" as const,
        parameter: Object.freeze({ kind: "type" as const, value: parameterType }),
      }),
    })]),
    targetGenerics: Object.freeze({
      parameters: Object.freeze([Object.freeze({
        kind: "type" as const,
        identity: parameterIdentity,
        displayName: "T",
        bounds: Object.freeze([]),
      })]),
      wherePredicates: Object.freeze([]),
    }),
  });
}

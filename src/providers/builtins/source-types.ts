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
  rustSourceTypeExportIds,
  rustSourceVirtualModulesProviderId,
  rustTypesModule,
} from "../../source/semantics/identity.js";
import type {
  RustProviderSemantics,
  RustProviderTypeRow,
} from "../packages/model.js";
import { rustNativeScalarTargetId } from "../../target-model/types/index.js";

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
  const scalarType = Object.freeze({
    exportId: rustSourceTypeExportIds.scalar,
    targetCarrier: Object.freeze({
      kind: "target-named" as const,
      id: rustNativeScalarTargetId,
    }),
    providerPackageId: "tsonic-rust-source",
    providerId: rustSourceVirtualModulesProviderId,
    providerVersion: rustSourceProviderVersion,
    providerModuleId: rustTypesModule,
    moduleSpecifier: rustTypesModule,
  });
  return Object.freeze({
    exports: Object.freeze([]),
    operations: Object.freeze([]),
    carrierPaths: Object.freeze({ [rustNativeScalarTargetId]: "char" }),
    carrierTraits: Object.freeze({}),
    binaryEpilogues: Object.freeze([]),
    types: Object.freeze([
      nativePointerType,
      rustConstPointerType,
      rustMutPointerType,
      scalarType,
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
  return Object.freeze({
    exportId,
    targetCarrier: Object.freeze({
      kind: "pointer",
      pointee: Object.freeze({ kind: "type-parameter", name: "T" }),
      mutability,
    }),
    providerPackageId,
    providerId,
    providerVersion,
    providerModuleId: moduleSpecifier,
    moduleSpecifier,
    genericParameters: Object.freeze([Object.freeze({
      kind: "type" as const,
      sourceName: "T",
    })]),
  });
}

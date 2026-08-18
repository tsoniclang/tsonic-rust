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
    carrierPaths: new Map(),
    carrierTraits: new Map(),
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
    sourceTypeParameters: Object.freeze(["T"]),
  });
}

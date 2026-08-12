import {
  tsonicCoreNativePointerProviderNames,
  tsonicCoreProviderVersion,
  tsonicCoreTypesModule,
  tsonicCoreVirtualModulesProviderId,
} from "@tsonic/source-core";
import type {
  RustProviderSemantics,
  RustProviderTypeRow,
} from "../provider-packages/index.js";

const nativePointerType: RustProviderTypeRow = Object.freeze({
  exportId: tsonicCoreNativePointerProviderNames.nativePointerExport,
  targetCarrier: Object.freeze({
    kind: "pointer",
    pointee: Object.freeze({ kind: "type-parameter", name: "T" }),
    mutability: "mut",
  }),
  providerPackageId: "tsonic-source-core",
  providerId: tsonicCoreVirtualModulesProviderId,
  providerVersion: tsonicCoreProviderVersion,
  providerModuleId: tsonicCoreTypesModule,
  moduleSpecifier: tsonicCoreTypesModule,
  sourceTypeParameters: Object.freeze(["T"]),
});

export function rustBuiltInSourceTypeSemantics(): RustProviderSemantics {
  return Object.freeze({
    exports: Object.freeze([]),
    operations: Object.freeze([]),
    carrierPaths: new Map(),
    types: Object.freeze([nativePointerType]),
  });
}

import type { ProviderDeclarationModel, SourceDeclarationProvider } from "@tsonic/tsts";
import { createSourceSemanticsVirtualModuleProvider, nativePointerProviderDeclaration, providerExportDeclarationsForSemanticsModule } from "@tsonic/source-core/extension";
import { rustLifetimeTypeDeclarations, rustReferenceOperationDeclarations } from "../extension/declarations/index.js";
import { rustLangModule, rustConstPointerExport, rustMutPointerExport, rustSourceProviderVersion, rustSourceTypeExportIds, rustSourceVirtualModulesProviderId, rustTypesModule } from "../../target-model/identities/source.js";
import { rustSourceSemanticsModules } from "./source-modules.js";

export function createRustSourceVirtualModulesProvider(): SourceDeclarationProvider {
  return createSourceSemanticsVirtualModuleProvider({
  id: rustSourceVirtualModulesProviderId,
  version: rustSourceProviderVersion,
  displayName: "Tsonic Rust source alias modules",
  virtualDirectory: "rust-source",
  modules: rustSourceSemanticsModules(),
  importsForModule(module) {
    return module.moduleSpecifier === rustLangModule
      ? [{
          moduleSpecifier: rustTypesModule,
          namedImports: Object.values(rustSourceTypeExportIds).map(
            (exportedName) => ({ exportedName, kind: "type" as const }),
          ),
          typeOnly: true,
        }, {
          moduleSpecifier: "@tsonic/rust/core/ops.js",
          namedImports: [{ exportedName: "Range", kind: "type" as const }],
          typeOnly: true,
        }, {
          moduleSpecifier: "@tsonic/rust/core/result.js",
          namedImports: [{ exportedName: "Result", kind: "type" as const }],
          typeOnly: true,
        }]
      : [];
  },
  exportsForModule: rustProviderExportsForModule,
  evidenceMessage:
    "Rust target supplies source alias semantics as a complete virtual module.",
  diagnostics: {
    unowned: {
      extensionCode: "RUST_SOURCE_MODULE_UNOWNED",
      numericCode: 9300001,
    },
    declarationMissing: {
      extensionCode: "RUST_SOURCE_MODULE_DECLARATION_MISSING",
      numericCode: 9300002,
    },
  },
}),;
}

export function rustProviderExportsForModule(
  module: ReturnType<typeof rustSourceSemanticsModules>[number],
): ProviderDeclarationModel["exports"] {
  const semantics = providerExportDeclarationsForSemanticsModule(module);
  return module.moduleSpecifier === rustTypesModule
    ? [
        ...semantics,
        ...rustLifetimeTypeDeclarations(),
        nativePointerProviderDeclaration(rustConstPointerExport),
        nativePointerProviderDeclaration(rustMutPointerExport),
      ]
    : module.moduleSpecifier === rustLangModule
      ? [...semantics, ...rustReferenceOperationDeclarations()]
      : semantics;
}

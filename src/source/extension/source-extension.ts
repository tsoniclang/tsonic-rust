import {
  sourceSemanticsExtensionId,
} from "@tsonic/tsts";
import type {
  CompilerExtension,
  ProviderDeclarationModel,
  SourceDeclarationProvider,
} from "@tsonic/tsts";
import {
  createSourceSemanticsVirtualModuleProvider,
  nativePointerProviderDeclaration,
  providerExportDeclarationsForSemanticsModule,
} from "@tsonic/source-core/extension";
import { analyzeRustSourceSemantics } from "../semantics/analysis/index.js";
import {
  rustLifetimeTypeDeclarations,
  rustReferenceOperationDeclarations,
} from "../semantics/declarations/index.js";
import {
  rustLangModule,
  rustSourceProviderVersion,
  rustSourceSemanticsExtensionId,
  rustSourceTypeExportIds,
  rustSourceVirtualModulesProviderId,
  rustTypesModule,
} from "../semantics/identity.js";
import { rustSourceSemanticsModules } from "../profiles/source-modules.js";

export {
  rustSourceProviderVersion,
  rustSourceSemanticsExtensionId,
  rustSourceVirtualModulesProviderId,
};
export const rustConstPointerExport = "constPtr";
export const rustMutPointerExport = "mutPtr";

export function createRustSourceSemanticsExtension(
  additionalProviders: readonly SourceDeclarationProvider[] = [],
): CompilerExtension {
  return {
    identity: {
      id: rustSourceSemanticsExtensionId,
      version: "0.0.1",
    },
    dependencies: {
      dependsOn: [sourceSemanticsExtensionId],
      runsAfter: [sourceSemanticsExtensionId],
    },
    initialize(context): void {
      context.registerSourceDeclarationProvider(
        createSourceSemanticsVirtualModuleProvider({
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
        }),
      );
      for (const provider of additionalProviders) {
        context.registerSourceDeclarationProvider(provider);
      }
    },
    analyzeSource(context): void {
      analyzeRustSourceSemantics(context);
    },
  };
}

function rustProviderExportsForModule(
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

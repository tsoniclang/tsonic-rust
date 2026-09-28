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
import {
  rustLifetimeTypeDeclarations,
  rustReferenceOperationDeclarations,
  rustSyntaxIntrinsicDeclarations,
} from "../semantics/declarations/index.js";
import {
  rustLangModule,
  rustConstPointerExport,
  rustMutPointerExport,
  rustSourceProviderVersion,
  rustSourceSemanticsExtensionId,
  rustSourceTypeExportIds,
  rustSourceVirtualModulesProviderId,
  rustTypesModule,
} from "../semantics/identity.js";
import { rustSourceSemanticsModules } from "../profiles/source-modules.js";
import { resolveRustSourceNativeInput, rustSourceNativeInputFactKey, type RustSourceNativeServices } from "../semantics/native-input.js";

export {
  rustConstPointerExport,
  rustMutPointerExport,
  rustSourceProviderVersion,
  rustSourceSemanticsExtensionId,
  rustSourceVirtualModulesProviderId,
};

export function createRustSourceSemanticsExtension(
  options: {
    readonly providers: readonly SourceDeclarationProvider[];
    readonly native: RustSourceNativeServices;
  },
): CompilerExtension {
  const providers = Object.freeze([...options.providers]);
  const native = Object.freeze({ macro: options.native.macro, tokenize: options.native.tokenize });
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
      context.registerSourceElaborator(rustSourceNativeInputFactKey,
        demand => resolveRustSourceNativeInput(demand, native));
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
        }),
      );
      for (const provider of providers) {
        context.registerSourceDeclarationProvider(provider);
      }
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
      ? [...semantics, ...rustReferenceOperationDeclarations(), ...rustSyntaxIntrinsicDeclarations()]
      : semantics;
}

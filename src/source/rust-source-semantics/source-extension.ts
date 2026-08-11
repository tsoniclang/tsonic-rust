import {
  sourceSemanticsExtensionId,
} from "@tsonic/tsts";
import type {
  CompilerExtension,
  SourceDeclarationProvider,
} from "@tsonic/tsts";
import {
  createSourceSemanticsVirtualModuleProvider,
} from "@tsonic/source-core";
import {
  rustSourceSemanticsModules,
} from "./source-modules.js";

export const rustSourceSemanticsExtensionId =
  "tsonic.rust.source-semantics";

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
          id: "tsonic.rust.source-virtual-modules",
          version: "0.0.1",
          displayName: "Tsonic Rust source alias modules",
          virtualDirectory: "rust-source",
          modules: rustSourceSemanticsModules(),
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
  };
}

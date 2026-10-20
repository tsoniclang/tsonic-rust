import { createRustSourceVirtualModulesProvider } from "../profiles/source-virtual-modules.js";
import { sourceSemanticsExtensionId } from "@tsonic/tsts";
import type { CompilerExtension, SourceDeclarationProvider } from "@tsonic/tsts";

import { rustConstPointerExport, rustMutPointerExport, rustSourceProviderVersion, rustSourceSemanticsExtensionId, rustSourceVirtualModulesProviderId } from "../../target-model/identities/source.js";

export {
  rustConstPointerExport,
  rustMutPointerExport,
  rustSourceProviderVersion,
  rustSourceSemanticsExtensionId,
  rustSourceVirtualModulesProviderId,
};

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
        createRustSourceVirtualModulesProvider()
      );
      for (const provider of additionalProviders) {
        context.registerSourceDeclarationProvider(provider);
      }
    },
  };
}

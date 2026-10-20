import { materializeClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { TstsSourceProviderContractVersion } from "@tsonic/tsts";
import type { CompilerExtension, ProviderDeclarationModel, ProviderModuleResolution, SourceDeclarationProvider } from "@tsonic/tsts";
import type { RustProviderPackageDefinition } from "./model.js";

import { rebaseProviderExport } from "./declarations.js";
export function createRustProviderPackageSourceExtension(definition: RustProviderPackageDefinition): CompilerExtension {
  return {
    identity: {
      id: `tsonic.rust.provider-package.${definition.id}`,
      version: definition.version,
    },
    initialize(context): void {
      context.registerSourceDeclarationProvider(createRustProviderPackageSourceProvider(definition));
    },
  };
}

export function createRustProviderPackageSourceProvider(definition: RustProviderPackageDefinition): SourceDeclarationProvider {
  const modulesBySpecifier = new Map(definition.modules.map((module) => [module.moduleSpecifier, module]));
  const canonicalSpecifierByPublicSpecifier = new Map<string, string>(
    definition.modules.map((module) => [module.moduleSpecifier, module.moduleSpecifier]),
  );
  for (const alias of definition.moduleAliases ?? []) {
    canonicalSpecifierByPublicSpecifier.set(alias.moduleSpecifier, alias.canonicalModuleSpecifier);
  }
  return {
    identity: {
      id: rustProviderBindingProviderId(definition.id),
      version: definition.version,
      extensionContractVersion: TstsSourceProviderContractVersion,
    },
    declarationMaterialization: "complete",
    ownsModule(specifier: string) {
      return canonicalSpecifierByPublicSpecifier.has(specifier)
        ? { kind: "owned" as const }
        : { kind: "unowned" as const };
    },
    resolveModule(specifier: string) {
      const canonicalSpecifier = canonicalSpecifierByPublicSpecifier.get(specifier);
      const module = canonicalSpecifier === undefined ? undefined : modulesBySpecifier.get(canonicalSpecifier);
      if (module === undefined) {
        return {
          extensionId: `tsonic.rust.provider-package.${definition.id}`,
          extensionCode: "RUST_PROVIDER_MODULE_NOT_OWNED",
          numericCode: 0,
          category: "error" as const,
          message: `Provider package '${definition.id}' does not own module '${specifier}'.`,
        };
      }
      return {
        kind: "virtual" as const,
        moduleSpecifier: specifier,
        virtualFileName: `tsts-provider://tsonic-rust/${definition.id}/${encodeURIComponent(specifier)}.d.ts`,
        providerModuleId: module.providerModuleId,
        packageName: specifier,
        packageVersion: definition.version,
      };
    },
    getDeclarationModel(resolution: ProviderModuleResolution): ProviderDeclarationModel {
      const canonicalSpecifier = canonicalSpecifierByPublicSpecifier.get(resolution.moduleSpecifier);
      const module = canonicalSpecifier === undefined ? undefined : modulesBySpecifier.get(canonicalSpecifier);
      if (module === undefined) {
        throw new Error(`Provider package '${definition.id}' cannot render unowned module '${resolution.moduleSpecifier}'.`);
      }
      if (resolution.providerModuleId !== module.providerModuleId) {
        throw new Error(`Provider package '${definition.id}' module '${resolution.moduleSpecifier}' was resolved with provider module id '${resolution.providerModuleId}', expected '${module.providerModuleId}'.`);
      }
      return materializeClosedMetadata({
        moduleSpecifier: resolution.moduleSpecifier,
        providerModuleId: module.providerModuleId,
        ...(module.imports === undefined ? {} : { imports: module.imports }),
        exports: module.exports.map((declaration) => rebaseProviderExport(
          declaration,
          module.moduleSpecifier,
          resolution.moduleSpecifier,
        )),
      });
    },
  };
}

export function rustProviderBindingProviderId(packageId: string): string {
  return `tsonic.rust.provider-package.${packageId}.binding`;
}

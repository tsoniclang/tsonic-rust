import { TstsProviderContractVersion } from "@tsonic/tsts";
import type {
  CompilerExtension,
  ProviderDeclarationModel,
  ProviderExportDeclaration,
  ProviderModuleResolution,
  ProviderSymbolIdentity,
  TargetBindingProvider,
  TargetIdentity,
  TargetTypeRef,
} from "@tsonic/tsts";
import type {
  TargetProviderPackageImplementation,
  TargetRuntimeContributionContext,
  TargetRuntimeContributions,
  TargetRuntimeReference,
} from "@tsonic/target-api";
import { cargoCrateAttributeName, cargoPathReferenceKind } from "../../backend/planner/cargo-project.js";
import type { RustProviderOperationForm } from "../rust-facts/keys.js";

// Generic Rust provider-package model. Concrete module specifiers, export
// names, and Rust operation paths live only in package definitions (product
// packages or test fakes), never in generic mapping code.

export interface RustProviderModuleDefinition {
  readonly moduleSpecifier: string;
  readonly providerModuleId: string;
  readonly exports: readonly ProviderExportDeclaration[];
}

export interface RustProviderOperationRow {
  readonly exportId: string;
  readonly memberId?: string;
  readonly signatureId?: string;
  readonly receiverTypeId?: string;
  readonly operationKind: "method" | "constructor" | "property" | "indexer";
  readonly target: RustProviderOperationForm;
  readonly resultCarrier: TargetTypeRef;
  readonly parameterCarriers?: readonly TargetTypeRef[];
  // Async provider operations produce future carriers that must be awaited.
  readonly isAsync?: boolean;
}

export interface RustProviderCrateDefinition {
  readonly crateName: string;
  readonly cargoPath: string;
}

export interface RustProviderPackageDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly requiredSurfaces?: readonly string[];
  readonly modules: readonly RustProviderModuleDefinition[];
  readonly operations: readonly RustProviderOperationRow[];
  readonly crates: readonly RustProviderCrateDefinition[];
  readonly targetIdentities?: Readonly<Record<string, string>>;
}

export interface RustProviderOperationContributor {
  rustProviderOperations(): readonly RustProviderOperationRow[];
}

export type RustProviderPackageImplementation =
  TargetProviderPackageImplementation & RustProviderOperationContributor;

export function createRustProviderPackage(definition: RustProviderPackageDefinition): RustProviderPackageImplementation {
  return {
    id: definition.id,
    displayName: definition.displayName,
    ...(definition.requiredSurfaces === undefined ? {} : { requiredSurfaces: definition.requiredSurfaces }),
    moduleOwnership: definition.modules.map((module) => ({ specifierPrefix: module.moduleSpecifier })),
    createExtensions(): readonly CompilerExtension[] {
      return [createRustProviderPackageBindingExtension(definition)];
    },
    runtimeContributions(_context: TargetRuntimeContributionContext): TargetRuntimeContributions {
      return {
        references: definition.crates.map((crate): TargetRuntimeReference => ({
          kind: cargoPathReferenceKind,
          include: crate.cargoPath,
          attributes: { [cargoCrateAttributeName]: crate.crateName },
        })),
      };
    },
    rustProviderOperations(): readonly RustProviderOperationRow[] {
      return definition.operations;
    },
  };
}

export function isRustProviderOperationContributor(
  value: object,
): value is RustProviderOperationContributor {
  return typeof (value as { rustProviderOperations?: unknown }).rustProviderOperations === "function";
}

export function collectRustProviderOperationRows(
  selectedPackages: readonly object[],
): readonly RustProviderOperationRow[] {
  const rows: RustProviderOperationRow[] = [];
  for (const selectedPackage of selectedPackages) {
    if (isRustProviderOperationContributor(selectedPackage)) {
      rows.push(...selectedPackage.rustProviderOperations());
    }
  }
  return rows;
}

function createRustProviderPackageBindingExtension(definition: RustProviderPackageDefinition): CompilerExtension {
  return {
    identity: {
      id: `tsonic.rust.provider-package.${definition.id}`,
      version: definition.version,
      capabilityNamespace: `tsonic.rust.provider-package.${definition.id}`,
    },
    initialize(context): void {
      context.registerTargetBindingProvider(createRustProviderPackageBindingProvider(definition));
    },
  };
}

export function createRustProviderPackageBindingProvider(definition: RustProviderPackageDefinition): TargetBindingProvider {
  const modulesBySpecifier = new Map(definition.modules.map((module) => [module.moduleSpecifier, module]));
  return {
    identity: {
      id: `tsonic.rust.provider-package.${definition.id}.binding`,
      version: definition.version,
      target: "rust",
      extensionContractVersion: TstsProviderContractVersion,
      providerKind: "binding",
    },
    ownsModule(specifier: string) {
      return modulesBySpecifier.has(specifier) ? { kind: "owned" as const } : { kind: "unowned" as const };
    },
    resolveModule(specifier: string) {
      const module = modulesBySpecifier.get(specifier);
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
        moduleSpecifier: module.moduleSpecifier,
        virtualFileName: `tsts-provider://tsonic-rust/${definition.id}/${encodeURIComponent(module.moduleSpecifier)}.d.ts`,
        providerModuleId: module.providerModuleId,
        packageName: module.moduleSpecifier,
        packageVersion: definition.version,
      };
    },
    getDeclarationModel(resolution: ProviderModuleResolution): ProviderDeclarationModel {
      const module = modulesBySpecifier.get(resolution.moduleSpecifier);
      if (module === undefined) {
        return { moduleSpecifier: resolution.moduleSpecifier, providerModuleId: resolution.providerModuleId, exports: [] };
      }
      return {
        moduleSpecifier: module.moduleSpecifier,
        providerModuleId: module.providerModuleId,
        exports: module.exports,
      };
    },
    getTargetIdentity(symbol: ProviderSymbolIdentity): TargetIdentity | undefined {
      const key = symbol.memberName === undefined
        ? `${symbol.moduleSpecifier}::${symbol.exportName ?? ""}`
        : `${symbol.moduleSpecifier}::${symbol.exportName ?? ""}.${symbol.memberName}`;
      const id = definition.targetIdentities?.[key];
      return id === undefined ? undefined : { target: "rust", id };
    },
  };
}

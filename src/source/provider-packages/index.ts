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
  // Cross-module type references (e.g. crypto returning buffer's Buffer).
  readonly imports?: readonly { readonly moduleSpecifier: string; readonly namedImports: readonly { readonly exportedName: string }[] }[];
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
  // As-cast applied to the lowered result (e.g. usize results as i32).
  readonly castResult?: string;
  // Async provider operations produce future carriers that must be awaited.
  readonly isAsync?: boolean;
  // Fallible operations return TsonicResult and require a fallible context.
  // Method and constructor operations support fallibility; package creation
  // rejects other kinds.
  readonly isFallible?: boolean;
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
  validateProviderPackageDefinition(definition);
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
        ...(module.imports === undefined ? {} : { imports: module.imports }),
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

// Creation-time validation: the declaration/identity model must be
// internally consistent before any compilation consumes it.
function validateProviderPackageDefinition(definition: RustProviderPackageDefinition): void {
  const fail = (message: string): never => {
    throw new Error(`Provider package '${definition.id}': ${message}`);
  };
  const moduleSpecifiers = new Set<string>();
  const exportIds = new Set<string>();
  const memberIds = new Set<string>();
  const signatureIds = new Set<string>();
  const exportNamesByModule = new Map<string, Set<string>>();
  for (const module of definition.modules) {
    if (moduleSpecifiers.has(module.moduleSpecifier)) {
      fail(`duplicate module '${module.moduleSpecifier}'`);
    }
    moduleSpecifiers.add(module.moduleSpecifier);
    const names = new Set<string>();
    exportNamesByModule.set(module.moduleSpecifier, names);
    for (const exported of module.exports) {
      if (exportIds.has(exported.id)) {
        fail(`duplicate export id '${exported.id}'`);
      }
      exportIds.add(exported.id);
      if (names.has(exported.name)) {
        fail(`duplicate export name '${exported.name}' in '${module.moduleSpecifier}'`);
      }
      names.add(exported.name);
      const members = (exported as { readonly members?: readonly { readonly id: string; readonly signatures?: readonly { readonly id: string }[] }[] }).members ?? [];
      for (const member of members) {
        if (memberIds.has(member.id)) {
          fail(`duplicate member id '${member.id}'`);
        }
        memberIds.add(member.id);
        for (const signature of member.signatures ?? []) {
          signatureIds.add(signature.id);
        }
      }
      const signatures = (exported as { readonly signatures?: readonly { readonly id: string }[] }).signatures ?? [];
      for (const signature of signatures) {
        if (signatureIds.has(signature.id)) {
          fail(`duplicate signature id '${signature.id}'`);
        }
        signatureIds.add(signature.id);
      }
    }
  }
  const providerRefIsDeclared = (reference: { readonly moduleSpecifier: string; readonly exportName: string }): boolean =>
    exportNamesByModule.get(reference.moduleSpecifier)?.has(reference.exportName) === true;
  const walkTypeRefs = (value: unknown, where: string): void => {
    if (value === null || typeof value !== "object") {
      return;
    }
    const record = value as { readonly kind?: unknown; readonly moduleSpecifier?: unknown; readonly exportName?: unknown };
    if (record.kind === "provider-ref") {
      if (typeof record.moduleSpecifier !== "string" || typeof record.exportName !== "string" ||
        !providerRefIsDeclared({ moduleSpecifier: record.moduleSpecifier, exportName: record.exportName })) {
        fail(`${where} references undeclared provider export '${String(record.moduleSpecifier)}::${String(record.exportName)}'`);
      }
      return;
    }
    for (const child of Object.values(value)) {
      walkTypeRefs(child, where);
    }
  };
  for (const module of definition.modules) {
    for (const imported of module.imports ?? []) {
      if (!moduleSpecifiers.has(imported.moduleSpecifier)) {
        fail(`module '${module.moduleSpecifier}' imports from undeclared module '${imported.moduleSpecifier}'`);
      }
      for (const named of imported.namedImports) {
        if (exportNamesByModule.get(imported.moduleSpecifier)?.has(named.exportedName) !== true) {
          fail(`module '${module.moduleSpecifier}' imports undeclared export '${named.exportedName}' from '${imported.moduleSpecifier}'`);
        }
      }
    }
    walkTypeRefs(module.exports, `module '${module.moduleSpecifier}'`);
  }
  const receiverTypeIds = new Set(definition.operations
    .map((row) => row.resultCarrier)
    .filter((carrier): carrier is { kind: "target-named"; id: string } => (carrier as { kind?: string }).kind === "target-named")
    .map((carrier) => carrier.id));
  for (const row of definition.operations) {
    const label = row.memberId ?? row.exportId;
    if (row.isFallible === true && row.operationKind !== "method" && row.operationKind !== "constructor") {
      fail(`isFallible is supported only on method and constructor operations (row '${label}').`);
    }
    if (!exportIds.has(row.exportId)) {
      fail(`row '${label}' targets undeclared exportId '${row.exportId}'`);
    }
    if (row.memberId !== undefined && !memberIds.has(row.memberId)) {
      fail(`row '${label}' targets undeclared memberId '${row.memberId}'`);
    }
    if (row.signatureId !== undefined && !signatureIds.has(row.signatureId)) {
      fail(`row '${label}' targets undeclared signatureId '${row.signatureId}'`);
    }
    if (row.receiverTypeId !== undefined && !receiverTypeIds.has(row.receiverTypeId)) {
      fail(`row '${label}' names receiverTypeId '${row.receiverTypeId}' that no row result carrier produces`);
    }
  }
}

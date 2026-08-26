import {
  TstsSourceProviderContractVersion,
} from "@tsonic/tsts";
import type {
  ExtensionDiagnostic,
  ProviderDeclarationModel,
  ProviderDeclarationRequest,
  ProviderModuleResolution,
  SourceDeclarationProvider,
} from "@tsonic/tsts";
import {
  closedMetadataEquals,
  closedMetadataKey,
  materializeClosedMetadata,
} from "../../target-model/metadata/closed-data.js";
import type { RustTargetConfigurationInput } from "../../target-model/configuration/model.js";
import {
  rustGenericsSemanticKey,
  rustTypeSemanticKey,
  type RustDialect,
} from "../../target-model/semantics/index.js";
import type {
  RustProviderModuleDefinition,
  RustProviderOperationDefinition,
  RustProviderPackageDefinition,
  RustProviderSemantics,
  RustProviderTypeDefinition,
} from "../packages/model.js";
import {
  mergeRustProviderSemantics,
  collectRustProviderSemanticsFromDefinitions,
} from "../packages/semantics.js";
import { rustProviderBindingProviderId } from "../packages/identity.js";
import type {
  RustCompilerDependency,
  RustCompilerProjectSnapshot,
} from "./model/model.js";
import {
  compilerModulePathFromSpecifier,
  compilerModuleSpecifier,
  compilerProviderModuleId,
  compilerProviderVersion,
  projectRustCompilerModule,
} from "./projection/projection.js";
import { standardModuleRequestFromSpecifier } from "./projection/module-specifier.js";
import type { RustCompilerProviderProjection } from "./projection/projection.js";
import type { RustNamedTypeTraitContractEntry } from "../../target-model/types/model.js";
import { createRustCompilerWorkerClient } from "./protocol/worker-client.js";
import type { RustCompilerWorkerClient } from "./protocol/worker-client.js";

export const rustCompilerProviderSpecifierPrefix = "@tsonic/rust/crates/";
const rustStandardProviderPackageId = "rust-standard-library";
const rustCompilerProviderPackageId = "rust-cargo-project";
const rustCompilerProviderDiagnosticCodes = Object.freeze({
  RUST_COMPILER_PROVIDER_MODULE_UNOWNED: 9_301_001,
  RUST_COMPILER_PROVIDER_IDENTITY_CONFLICT: 9_301_002,
  RUST_COMPILER_PROVIDER_DECLARATION_FAILED: 9_301_003,
});
type RustCompilerProviderDiagnosticCode = keyof typeof rustCompilerProviderDiagnosticCodes;

export interface RustCompilerProviderSession {
  readonly sourceProviders: readonly SourceDeclarationProvider[];
  readonly dialect: RustDialect;
  semantics(): RustProviderSemantics;
  close(): void;
}

export function createRustCompilerProviderSession(
  context: {
    readonly configuration: RustTargetConfigurationInput;
  },
  worker: RustCompilerWorkerClient = createRustCompilerWorkerClient(),
): RustCompilerProviderSession {
  const standardSnapshot = worker.standardSnapshot();
  const dialect: RustDialect = Object.freeze({
    edition: context.configuration.edition,
    compilerIdentity: standardSnapshot.compiler.rustcVerboseVersion,
    enabledLanguageFeatures: Object.freeze([]),
  });
  const standardSnapshotLease = createCompilerSnapshotLease(standardSnapshot);
  const standardVersion = compilerProviderVersion(standardSnapshot.digest);
  const standardRegistry = createProjectionRegistry({
    packageId: rustStandardProviderPackageId,
    displayName: "Rust standard-library compiler provider",
    providerVersion: standardVersion,
    compilationSnapshotId: standardSnapshot.digest,
  });
  const standardProvider = createCompilerProvider({
    packageId: rustStandardProviderPackageId,
    displayName: "Rust standard-library compiler provider",
    virtualScope: "standard",
    snapshotLease: standardSnapshotLease,
    configHash: standardSnapshot.digest,
    providerVersion: standardVersion,
    worker,
    registry: standardRegistry,
    resolveModule(snapshot, specifier) {
      const request = standardModuleRequestFromSpecifier(specifier);
      if (request === undefined) {
        return undefined;
      }
      const dependency = snapshot.dependencies.find((candidate) =>
        candidate.alias === request.crateName);
      return dependency === undefined ? undefined : { dependency, modulePath: request.modulePath };
    },
  });
  const project = context.configuration.project;
  if (project.kind === "generated") {
    return createCompilerProviderSessionResult({
      dialect,
      sourceProviders: Object.freeze([standardProvider]),
      registries: Object.freeze([standardRegistry]),
      snapshotLeases: Object.freeze([standardSnapshotLease]),
      createSemantics: () => standardRegistry.semantics(),
    });
  }
  const manifestPath = project.manifestPath;
  const snapshot = worker.snapshot(manifestPath);
  const snapshotLease = createCompilerSnapshotLease(snapshot);
  const providerVersion = compilerProviderVersion(snapshot.digest);
  const registry = createProjectionRegistry({
    packageId: rustCompilerProviderPackageId,
    displayName: "Rust Cargo compiler provider",
    providerVersion,
    compilationSnapshotId: snapshot.digest,
  });
  const sourceProviders = [
    standardProvider,
    createCompilerProvider({
      packageId: rustCompilerProviderPackageId,
      displayName: "Rust Cargo compiler provider",
      virtualScope: "cargo",
      snapshotLease,
      configHash: snapshot.digest,
      providerVersion,
      worker,
      registry,
      resolveModule(leasedSnapshot, specifier) {
        return resolveCompilerModule(leasedSnapshot, specifier);
      },
    }),
  ];
  return createCompilerProviderSessionResult({
    dialect,
    sourceProviders: Object.freeze(sourceProviders),
    registries: Object.freeze([standardRegistry, registry]),
    snapshotLeases: Object.freeze([standardSnapshotLease, snapshotLease]),
    createSemantics: () => mergeRustProviderSemantics(
      standardRegistry.semantics(),
      registry.semantics(),
    ),
  });
}

function createCompilerProviderSessionResult(options: {
  readonly dialect: RustDialect;
  readonly sourceProviders: readonly SourceDeclarationProvider[];
  readonly registries: readonly ProjectionRegistry[];
  readonly snapshotLeases: readonly CompilerSnapshotLease[];
  readonly createSemantics: () => RustProviderSemantics;
}): RustCompilerProviderSession {
  let state: "open" | "sealed" | "closed" = "open";
  let semantics: RustProviderSemantics | undefined;
  return Object.freeze({
    sourceProviders: options.sourceProviders,
    dialect: options.dialect,
    semantics(): RustProviderSemantics {
      if (state === "closed") {
        throw new Error("Rust compiler-provider session is closed.");
      }
      if (semantics === undefined) {
        semantics = options.createSemantics();
        state = "sealed";
      }
      return semantics;
    },
    close(): void {
      if (state === "closed") {
        return;
      }
      for (const registry of options.registries) {
        registry.close();
      }
      for (const lease of options.snapshotLeases) {
        lease.close();
      }
      semantics = undefined;
      state = "closed";
    },
  });
}

interface ResolvedCompilerModule {
  readonly dependency: RustCompilerDependency;
  readonly modulePath: readonly string[];
}

interface CompilerSnapshotLease {
  get(): RustCompilerProjectSnapshot;
  close(): void;
}

function createCompilerSnapshotLease(
  initial: RustCompilerProjectSnapshot,
): CompilerSnapshotLease {
  let snapshot: RustCompilerProjectSnapshot | undefined = initial;
  return Object.freeze({
    get(): RustCompilerProjectSnapshot {
      if (snapshot === undefined) {
        throw new Error("Rust compiler-provider snapshot lease is closed.");
      }
      return snapshot;
    },
    close(): void {
      snapshot = undefined;
    },
  });
}

function createCompilerProvider(
  options: {
    readonly packageId: string;
    readonly displayName: string;
    readonly virtualScope: string;
    readonly snapshotLease: CompilerSnapshotLease;
    readonly configHash: string;
    readonly providerVersion: string;
    readonly worker: RustCompilerWorkerClient;
    readonly registry: ProjectionRegistry;
    readonly resolveModule: (
      snapshot: RustCompilerProjectSnapshot,
      specifier: string,
    ) => ResolvedCompilerModule | undefined;
  },
): SourceDeclarationProvider {
  const providerId = rustProviderBindingProviderId(options.packageId);
  return Object.freeze({
    identity: Object.freeze({
      id: providerId,
      version: options.providerVersion,
      extensionContractVersion: TstsSourceProviderContractVersion,
      configHash: options.configHash,
      displayName: options.displayName,
    }),
    declarationMaterialization: "incremental",
    ownsModule(specifier: string) {
      return options.resolveModule(options.snapshotLease.get(), specifier) === undefined
        ? { kind: "unowned" as const }
        : { kind: "owned" as const };
    },
    resolveModule(specifier: string) {
      const snapshot = options.snapshotLease.get();
      const resolved = options.resolveModule(snapshot, specifier);
      if (resolved === undefined) {
        return providerDiagnostic(providerId,
          "RUST_COMPILER_PROVIDER_MODULE_UNOWNED",
          `${options.displayName} does not own '${specifier}'.`,
        );
      }
      const { dependency, modulePath } = resolved;
      return Object.freeze({
        kind: "virtual" as const,
        moduleSpecifier: specifier,
        virtualFileName: `tsts-provider://tsonic-rust/compiler/${options.virtualScope}/${encodeURIComponent(dependency.alias)}/${modulePath.length === 0 ? "index" : modulePath.map(encodeURIComponent).join("/")}.d.ts`,
        providerModuleId: compilerProviderModuleId(dependency, modulePath),
        packageName: dependency.packageName,
        packageVersion: dependency.packageVersion,
      });
    },
    getDeclarationModel(
      resolution: ProviderModuleResolution,
      request: ProviderDeclarationRequest,
    ): ProviderDeclarationModel | ExtensionDiagnostic {
      const snapshot = options.snapshotLease.get();
      const resolved = options.resolveModule(snapshot, resolution.moduleSpecifier);
      if (resolved === undefined) {
        return providerDiagnostic(providerId,
          "RUST_COMPILER_PROVIDER_MODULE_UNOWNED",
          `${options.displayName} cannot materialize '${resolution.moduleSpecifier}'.`,
        );
      }
      const { dependency, modulePath } = resolved;
      const expectedModuleId = compilerProviderModuleId(dependency, modulePath);
      if (resolution.providerModuleId !== expectedModuleId) {
        return providerDiagnostic(providerId,
          "RUST_COMPILER_PROVIDER_IDENTITY_CONFLICT",
          `${options.displayName} module '${resolution.moduleSpecifier}' resolved as '${resolution.providerModuleId}', expected '${expectedModuleId}'.`,
        );
      }
      try {
        const requestedExports = requestedExportNames(request);
        const module = options.worker.module({
          snapshot,
          dependency,
          modulePath,
          ...(requestedExports === undefined ? {} : { requestedExports }),
        });
        const projection = projectRustCompilerModule(module, {
          providerPackageId: options.packageId,
          providerId,
          providerVersion: options.providerVersion,
          compilationSnapshotId: snapshot.digest,
          providerModuleId: expectedModuleId,
          moduleSpecifier: resolution.moduleSpecifier,
        });
        options.registry.add(projection);
        return materializeClosedMetadata(projection.declarationModel);
      } catch (error) {
        return providerDiagnostic(providerId,
          "RUST_COMPILER_PROVIDER_DECLARATION_FAILED",
          `${options.displayName} module '${resolution.moduleSpecifier}' cannot be represented: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  });
}

interface ProjectionRegistry {
  add(projection: RustCompilerProviderProjection): void;
  semantics(): RustProviderSemantics;
  close(): void;
}

function createProjectionRegistry(options: {
  readonly packageId: string;
  readonly displayName: string;
  readonly providerVersion: string;
  readonly compilationSnapshotId: string;
}): ProjectionRegistry {
  const modules = new Map<string, {
    readonly providerModuleId: string;
    readonly exports: Map<string, RustProviderModuleDefinition["exports"][number]>;
    readonly imports: Map<string, Set<string>>;
  }>();
  const operationsByIdentity = new Map<string, RustProviderOperationDefinition>();
  const typesByIdentity = new Map<string, RustProviderTypeDefinition>();
  const traitContracts = new Map<string, RustNamedTypeTraitContractEntry>();
  let state: "open" | "sealed" | "closed" = "open";
  let sealedSemantics: RustProviderSemantics | undefined;
  return Object.freeze({
    add(projection: RustCompilerProviderProjection): void {
      if (state !== "open") {
        throw new Error("Rust compiler-provider semantics are sealed for backend consumption.");
      }
      const existingModule = modules.get(projection.module.moduleSpecifier);
      if (existingModule !== undefined &&
        existingModule.providerModuleId !== projection.module.providerModuleId) {
        throw new Error(`Rust compiler-provider module '${projection.module.moduleSpecifier}' has conflicting provider module identities.`);
      }
      const module = existingModule ?? {
        providerModuleId: projection.module.providerModuleId,
        exports: new Map(),
        imports: new Map(),
      };
      modules.set(projection.module.moduleSpecifier, module);
      for (const exported of projection.module.exports) {
        addExact(module.exports, exported.id, exported, "export");
      }
      for (const imported of projection.module.imports ?? []) {
        const names = module.imports.get(imported.moduleSpecifier) ?? new Set<string>();
        module.imports.set(imported.moduleSpecifier, names);
        for (const named of imported.namedImports) {
          names.add(named.exportedName);
        }
      }
      for (const row of projection.operations) {
        addExact(operationsByIdentity, providerOperationIdentity(row), row, "operation");
      }
      for (const row of projection.types) {
        addExact(typesByIdentity, providerTypeIdentity(row), row, "type");
      }
      for (const [identityKey, entry] of projection.traitContracts) {
        const existing = traitContracts.get(identityKey);
        if (existing !== undefined && !closedMetadataEquals(existing, entry)) {
          throw new Error(`Rust compiler-provider carrier '${identityKey}' has conflicting native trait contracts.`);
        }
        traitContracts.set(identityKey, entry);
      }
    },
    semantics(): RustProviderSemantics {
      if (state === "closed") {
        throw new Error("Rust compiler-provider registry is closed.");
      }
      if (sealedSemantics !== undefined) {
        return sealedSemantics;
      }
      state = "sealed";
      const moduleDefinitions = [...modules.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([moduleSpecifier, module]): RustProviderModuleDefinition => Object.freeze({
          moduleSpecifier,
          providerModuleId: module.providerModuleId,
          ...(module.imports.size === 0
            ? {}
            : {
                imports: Object.freeze([...module.imports.entries()]
                  .sort(([left], [right]) => compareText(left, right))
                  .map(([importedModule, names]) => Object.freeze({
                    moduleSpecifier: importedModule,
                    namedImports: Object.freeze([...names].sort(compareText)
                      .map((exportedName) => Object.freeze({ exportedName }))),
                  }))),
              }),
          exports: Object.freeze([...module.exports.entries()]
            .sort(([left], [right]) => compareText(left, right))
            .map(([, exported]) => exported)),
        }));
      const selectedTraitContracts = Object.freeze(
        [...traitContracts.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, entry]) => entry),
      );
      const ownedModuleSpecifiers = new Set(moduleDefinitions.map((module) => module.moduleSpecifier));
      const sourceDependencyNames = new Map<string, Set<string>>();
      for (const module of moduleDefinitions) {
        for (const imported of module.imports ?? []) {
          if (ownedModuleSpecifiers.has(imported.moduleSpecifier)) {
            continue;
          }
          const names = sourceDependencyNames.get(imported.moduleSpecifier) ?? new Set<string>();
          sourceDependencyNames.set(imported.moduleSpecifier, names);
          for (const named of imported.namedImports) {
            names.add(named.exportedName);
          }
        }
      }
      const sourceDependencies = [...sourceDependencyNames.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([moduleSpecifier, names]) => Object.freeze({
          moduleSpecifier,
          exportedNames: Object.freeze([...names].sort(compareText)),
        }));
      const definition: RustProviderPackageDefinition = Object.freeze({
        id: options.packageId,
        displayName: options.displayName,
        version: options.providerVersion,
        compilationSnapshotId: options.compilationSnapshotId,
        ...(sourceDependencies.length === 0 ? {} : { sourceDependencies: Object.freeze(sourceDependencies) }),
        modules: Object.freeze(moduleDefinitions),
        types: Object.freeze([...typesByIdentity.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, type]) => type)),
        operations: Object.freeze([...operationsByIdentity.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, operation]) => operation)),
        crates: Object.freeze([]),
        ...(selectedTraitContracts.length === 0
          ? {}
          : { traitContracts: selectedTraitContracts }),
      });
      sealedSemantics = collectRustProviderSemanticsFromDefinitions([definition]);
      return sealedSemantics;
    },
    close(): void {
      if (state === "closed") {
        return;
      }
      for (const module of modules.values()) {
        module.exports.clear();
        for (const names of module.imports.values()) {
          names.clear();
        }
        module.imports.clear();
      }
      modules.clear();
      operationsByIdentity.clear();
      typesByIdentity.clear();
      traitContracts.clear();
      sealedSemantics = undefined;
      state = "closed";
    },
  });
}

function resolveCompilerModule(
  snapshot: RustCompilerProjectSnapshot,
  specifier: string,
): { readonly dependency: RustCompilerDependency; readonly modulePath: readonly string[] } | undefined {
  for (const dependency of snapshot.dependencies) {
    const modulePath = compilerModulePathFromSpecifier(dependency.alias, specifier);
    if (modulePath !== undefined) {
      return { dependency, modulePath };
    }
  }
  return undefined;
}

function requestedExportNames(
  request: ProviderDeclarationRequest,
): readonly string[] | undefined {
  if (request.materialization.kind === "complete" || request.context.importSlice?.broadImport === true) {
    return undefined;
  }
  const requested = new Set([
    ...(request.context.importSlice?.requestedExports ?? []).map((entry) => entry.exportedName),
    ...request.materialization.completeExports.map((entry) => entry.exportName),
  ]);
  return requested.size === 0 ? undefined : Object.freeze([...requested].sort(compareText));
}

function addExact<T>(
  map: Map<string, T>,
  identity: string,
  value: T,
  kind: string,
): void {
  const existing = map.get(identity);
  if (existing !== undefined && !closedMetadataEquals(existing, value)) {
    throw new Error(`Rust compiler-provider ${kind} '${identity}' has conflicting projections.`);
  }
  map.set(identity, value);
}

function providerOperationIdentity(row: RustProviderOperationDefinition): string {
  return `${row.exportId}\0${row.memberId ?? ""}\0${row.signatureId ?? ""}\0${row.operationKind}`;
}

function providerTypeIdentity(row: RustProviderTypeDefinition): string {
  return `${row.exportId}\0${row.targetDeclarationKind}\0${row.targetTraitKind ?? ""}\0${row.targetTraitSafety ?? ""}\0${String(row.targetTraitRequiresImplementationItems ?? "")}\0${closedMetadataKey(row.targetImplicitParameters)}\0${closedMetadataKey(row.semanticRoles)}\0${rustGenericsSemanticKey(row.targetGenerics)}\0${rustTypeSemanticKey(row.targetCarrier)}`;
}

function providerDiagnostic(
  extensionId: string,
  code: RustCompilerProviderDiagnosticCode,
  message: string,
): ExtensionDiagnostic {
  return {
    extensionId,
    extensionCode: code,
    numericCode: rustCompilerProviderDiagnosticCodes[code],
    category: "error",
    message,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rustCompilerProviderRootModule(dependencyAlias: string): string {
  return compilerModuleSpecifier(dependencyAlias, []);
}

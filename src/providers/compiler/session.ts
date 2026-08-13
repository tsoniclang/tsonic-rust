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
import type { TargetProviderContext } from "@tsonic/target-api";
import { materializeClosedMetadata } from "../../common/closed-metadata.js";
import { resolveRustUserCargoManifest } from "../../options/rust-user-project.js";
import type {
  RustProviderModuleDefinition,
  RustProviderOperationDefinition,
  RustProviderPackageDefinition,
  RustProviderSemantics,
  RustProviderTypeDefinition,
} from "../../source/provider-packages/index.js";
import {
  collectRustProviderSemanticsFromDefinitions,
  createRustProviderPackageSourceProvider,
  rustProviderBindingProviderId,
} from "../../source/provider-packages/index.js";
import type {
  RustCompilerDependency,
  RustCompilerProjectSnapshot,
} from "./model.js";
import {
  compilerModulePathFromSpecifier,
  compilerModuleSpecifier,
  compilerProviderModuleId,
  compilerProviderVersion,
  projectRustCompilerModule,
} from "./projection.js";
import type { RustCompilerProviderProjection } from "./projection.js";
import { createRustCompilerWorkerClient } from "./worker-client.js";
import type { RustCompilerWorkerClient } from "./worker-client.js";
import {
  rustStdProviderDefinition,
} from "./std-catalog.js";

export const rustCompilerProviderSpecifierPrefix = "@tsonic/rust/crates/";
const rustCompilerProviderPackageId = "rust-cargo-project";
const rustCompilerProviderDiagnosticCodes = Object.freeze({
  RUST_COMPILER_PROVIDER_MODULE_UNOWNED: 9_301_001,
  RUST_COMPILER_PROVIDER_IDENTITY_CONFLICT: 9_301_002,
  RUST_COMPILER_PROVIDER_DECLARATION_FAILED: 9_301_003,
});
type RustCompilerProviderDiagnosticCode = keyof typeof rustCompilerProviderDiagnosticCodes;

export interface RustCompilerProviderSession {
  readonly snapshot?: RustCompilerProjectSnapshot;
  readonly sourceProviders: readonly SourceDeclarationProvider[];
  semantics(): RustProviderSemantics;
}

export function createRustCompilerProviderSession(
  context: TargetProviderContext,
  worker: RustCompilerWorkerClient = createRustCompilerWorkerClient(),
): RustCompilerProviderSession {
  const standardDefinition = rustStdProviderDefinition();
  const standardProvider = createRustProviderPackageSourceProvider(standardDefinition);
  const emptySemantics = collectRustProviderSemanticsFromDefinitions([]);
  const projectFile = resolveRustUserCargoManifest(context.target, context.projectDirectory);
  if (projectFile.kind === "absent") {
    return Object.freeze({
      sourceProviders: Object.freeze([standardProvider]),
      semantics: () => emptySemantics,
    });
  }
  if (projectFile.kind === "invalid") {
    throw new Error(projectFile.message);
  }
  const manifestPath = projectFile.manifestPath;
  const snapshot = worker.snapshot(manifestPath);
  const providerVersion = compilerProviderVersion(snapshot.digest);
  const registry = createProjectionRegistry(providerVersion);
  const sourceProviders = [
    standardProvider,
    createProjectProvider(snapshot, providerVersion, worker, registry),
  ];
  return Object.freeze({
    snapshot,
    sourceProviders: Object.freeze(sourceProviders),
    semantics: () => registry.semantics(),
  });
}

function createProjectProvider(
  snapshot: RustCompilerProjectSnapshot,
  providerVersion: string,
  worker: RustCompilerWorkerClient,
  registry: ProjectionRegistry,
): SourceDeclarationProvider {
  const providerId = rustProviderBindingProviderId(rustCompilerProviderPackageId);
  return Object.freeze({
    identity: Object.freeze({
      id: providerId,
      version: providerVersion,
      extensionContractVersion: TstsSourceProviderContractVersion,
      configHash: snapshot.digest,
      displayName: "Rust Cargo compiler provider",
    }),
    declarationMaterialization: "incremental",
    ownsModule(specifier: string) {
      return resolveCompilerModule(snapshot, specifier) === undefined
        ? { kind: "unowned" as const }
        : { kind: "owned" as const };
    },
    resolveModule(specifier: string) {
      const resolved = resolveCompilerModule(snapshot, specifier);
      if (resolved === undefined) {
        return providerDiagnostic(providerId,
          "RUST_COMPILER_PROVIDER_MODULE_UNOWNED",
          `Rust Cargo compiler provider does not own '${specifier}'.`,
        );
      }
      const { dependency, modulePath } = resolved;
      return Object.freeze({
        kind: "virtual" as const,
        moduleSpecifier: specifier,
        virtualFileName: `tsts-provider://tsonic-rust/compiler/${encodeURIComponent(dependency.alias)}/${modulePath.length === 0 ? "index" : modulePath.map(encodeURIComponent).join("/")}.d.ts`,
        providerModuleId: compilerProviderModuleId(dependency, modulePath),
        packageName: dependency.packageName,
        packageVersion: dependency.packageVersion,
      });
    },
    getDeclarationModel(
      resolution: ProviderModuleResolution,
      request: ProviderDeclarationRequest,
    ): ProviderDeclarationModel | ExtensionDiagnostic {
      const resolved = resolveCompilerModule(snapshot, resolution.moduleSpecifier);
      if (resolved === undefined) {
        return providerDiagnostic(providerId,
          "RUST_COMPILER_PROVIDER_MODULE_UNOWNED",
          `Rust Cargo compiler provider cannot materialize '${resolution.moduleSpecifier}'.`,
        );
      }
      const { dependency, modulePath } = resolved;
      const expectedModuleId = compilerProviderModuleId(dependency, modulePath);
      if (resolution.providerModuleId !== expectedModuleId) {
        return providerDiagnostic(providerId,
          "RUST_COMPILER_PROVIDER_IDENTITY_CONFLICT",
          `Rust Cargo module '${resolution.moduleSpecifier}' resolved as '${resolution.providerModuleId}', expected '${expectedModuleId}'.`,
        );
      }
      try {
        const requestedExports = requestedExportNames(request);
        const module = worker.module({
          snapshot,
          dependency,
          modulePath,
          ...(requestedExports === undefined ? {} : { requestedExports }),
        });
        const projection = projectRustCompilerModule(module, {
          providerModuleId: expectedModuleId,
          moduleSpecifier: resolution.moduleSpecifier,
        });
        registry.add(projection);
        return materializeClosedMetadata(projection.declarationModel);
      } catch (error) {
        return providerDiagnostic(providerId,
          "RUST_COMPILER_PROVIDER_DECLARATION_FAILED",
          `Rust Cargo module '${resolution.moduleSpecifier}' cannot be represented: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  });
}

interface ProjectionRegistry {
  add(projection: RustCompilerProviderProjection): void;
  semantics(): RustProviderSemantics;
}

function createProjectionRegistry(providerVersion: string): ProjectionRegistry {
  const modules = new Map<string, {
    readonly providerModuleId: string;
    readonly exports: Map<string, RustProviderModuleDefinition["exports"][number]>;
    readonly imports: Map<string, Set<string>>;
  }>();
  const operationsByIdentity = new Map<string, RustProviderOperationDefinition>();
  const typesByIdentity = new Map<string, RustProviderTypeDefinition>();
  const carrierPaths = new Map<string, string>();
  let sealed = false;
  return Object.freeze({
    add(projection: RustCompilerProviderProjection): void {
      if (sealed) {
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
      for (const [id, path] of projection.carrierPaths) {
        const existing = carrierPaths.get(id);
        if (existing !== undefined && existing !== path) {
          throw new Error(`Rust compiler-provider carrier '${id}' maps to both '${existing}' and '${path}'.`);
        }
        carrierPaths.set(id, path);
      }
    },
    semantics(): RustProviderSemantics {
      sealed = true;
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
      const carrierPathRecord = Object.fromEntries(
        [...carrierPaths.entries()].sort(([left], [right]) => compareText(left, right)),
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
        id: rustCompilerProviderPackageId,
        displayName: "Rust Cargo compiler provider",
        version: providerVersion,
        ...(sourceDependencies.length === 0 ? {} : { sourceDependencies: Object.freeze(sourceDependencies) }),
        modules: Object.freeze(moduleDefinitions),
        types: Object.freeze([...typesByIdentity.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, type]) => type)),
        operations: Object.freeze([...operationsByIdentity.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, operation]) => operation)),
        crates: Object.freeze([]),
        ...(Object.keys(carrierPathRecord).length === 0
          ? {}
          : { carrierPaths: Object.freeze(carrierPathRecord) }),
      });
      return collectRustProviderSemanticsFromDefinitions([definition]);
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
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) {
    throw new Error(`Rust compiler-provider ${kind} '${identity}' has conflicting projections.`);
  }
  map.set(identity, value);
}

function providerOperationIdentity(row: RustProviderOperationDefinition): string {
  return `${row.exportId}\0${row.memberId ?? ""}\0${row.signatureId ?? ""}\0${row.operationKind}`;
}

function providerTypeIdentity(row: RustProviderTypeDefinition): string {
  return `${row.exportId}\0${JSON.stringify(row.targetCarrier)}`;
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

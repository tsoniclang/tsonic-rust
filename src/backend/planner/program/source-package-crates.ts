import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustSourceFileOutputIdentity } from "../names/source-output-identities.js";
import type { CargoDependency, CargoManifestPlan } from "../../artifact-model/project/cargo.js";
import type { RustPlannedArtifact } from "../../artifact-model/output.js";
import {
  createRustSourceFile,
  type RustItem,
  type RustSourceFileModel,
} from "../../target-ast/nodes.js";
import { rustPublicSignatureTypeNames } from "../../target-ast/normalization/source-style.js";
import type { RustPlanningContext } from "../context.js";
import { planRustStructuralShapeModule } from "../objects/structural-shapes.js";
import { planRustProgramErrorModule } from "./errors.js";
import type { PlannedRustSourceFile } from "./source-file.js";
import type { RustSourcePackageComponentPlan } from "./source-package-components.js";
import type {
  RustSourcePackageFacadeExport,
  RustSourcePackageFacadePlan,
} from "./source-package-facades.js";
import type { RustSourcePackageInitializerPlan } from "./source-package-initializers.js";
import type { RustSourcePackageErrorPlan } from "./source-package-errors.js";

export interface RustSourcePackageCrateContentPlan {
  readonly component: RustSourcePackageComponentPlan;
  readonly initializerFacadeModuleName: string;
  readonly sources: readonly PlannedRustSourceFile[];
  readonly libraryItems: readonly RustItem[];
  readonly programErrorModel?: RustSourceFileModel;
  readonly structuralShapeModel?: RustSourceFileModel;
  readonly initializerFacadeModel?: RustSourceFileModel;
  readonly structuralShapeNames: ReadonlySet<string>;
  readonly syntheticModules: ReadonlyMap<string, RustSourceFileModel>;
}

export interface RustSourcePackageCargoPlan {
  readonly rootManifest: CargoManifestPlan;
  readonly externalManifestsByComponentId: ReadonlyMap<
    string,
    { readonly directory: `crates/${string}`; readonly manifest: CargoManifestPlan }
  >;
}

type RustPlannedSourceArtifact = Extract<RustPlannedArtifact, { readonly kind: "source" }>;
type RustCrateArtifactPrefix = "" | `crates/${string}`;

export function planRustSourcePackageCrateContent(
  input: RustPlanningContext,
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  component: RustSourcePackageComponentPlan,
  sources: readonly PlannedRustSourceFile[],
  facadePlan: RustSourcePackageFacadePlan,
  packageInitializers: RustSourcePackageInitializerPlan,
  sourcePackageErrors: RustSourcePackageErrorPlan,
  moduleNameByFileName: ReadonlyMap<string, string>,
  externalCrateNameByFileName: ReadonlyMap<string, string>,
  externalItemPathByIdentity: ReadonlyMap<string, string>,
  externalStructuralShapeModuleByFileName: ReadonlyMap<string, string>,
  diagnostics: TargetDiagnostic[],
): RustSourcePackageCrateContentPlan | undefined {
  const initializerFacadeModuleName = packageInitializers.facadeModuleNameByComponent.get(
    component.componentId,
  );
  if (initializerFacadeModuleName === undefined) {
    diagnostics.push(crateDiagnostic(
      "RUST_SOURCE_PACKAGE_INITIALIZER_COMPONENT_MISSING",
      `Source-package component '${component.componentId}' has no exact initializer facade identity.`,
    ));
    return undefined;
  }
  const componentExports = facadePlan.exportsByComponentId.get(component.componentId) ?? [];
  const facades = applyRustSourcePackageFacades(sources, componentExports);
  const structuralShapePathPrefix = `crate::${component.structuralShapesModuleName}::`;
  const structuralShapeNames = new Set(facades.sources.flatMap((source) =>
    rustPublicSignatureTypeNames(source.model)
      .filter((name) => name.startsWith(structuralShapePathPrefix))
      .map((name) => name.slice(structuralShapePathPrefix.length))));
  const structuralShapeModel = planRustStructuralShapeModule(
    input,
    moduleNameByFileName,
    externalCrateNameByFileName,
    externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    component.crateName,
    component.structuralShapesModuleName,
    component.componentId,
    structuralShapeNames,
    diagnostics,
  );
  const errorDomain = sourcePackageErrors.domainsByComponentId.get(component.componentId);
  if (errorDomain === undefined) {
    diagnostics.push(crateDiagnostic(
      "RUST_SOURCE_PACKAGE_ERROR_DOMAIN_MISSING",
      `Source-package component '${component.componentId}' has no exact error-domain plan.`,
    ));
    return undefined;
  }
  const programErrorModel = planRustProgramErrorModule(
    input,
    moduleNameByFileName,
    errorDomain,
    diagnostics,
  );
  const initializerFacadeModel = planRustInitializerFacadeModule(
    facades.sources,
    packageInitializers,
    component.componentId,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return undefined;
  }
  const componentIdentities = new Map([...identities].filter(([, identity]) =>
    identity.componentId === component.componentId));
  const topLevelModuleNames = new Set<string>();
  for (const identity of componentIdentities.values()) {
    const topLevelModuleName = identity.moduleSegments[0];
    if (topLevelModuleName === undefined) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_MODULE_IDENTITY_MISSING",
        `Source file '${identity.fileName}' has no exact top-level Rust module identity.`,
      ));
      continue;
    }
    topLevelModuleNames.add(topLevelModuleName);
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  const publicModuleNames = facadePlan.publicModuleNamesByComponent.get(
    component.componentId,
  ) ?? new Set<string>();
  const publicImplementationModuleNames = component.publicImplementationModuleNames;
  const publicTopLevelModuleNames = new Set([...publicModuleNames]
    .filter((name) => !name.includes("::")));
  const libraryItems: RustItem[] = [
    ...(programErrorModel === undefined
      ? []
      : [{
          kind: "mod-decl" as const,
          name: component.programModuleName,
          visibility: "public" as const,
          attrs: ["#[doc(hidden)]"],
        }]),
    ...(structuralShapeModel === undefined
      ? []
      : [{
          kind: "mod-decl" as const,
          name: component.structuralShapesModuleName,
          visibility: structuralShapeNames.size > 0
            ? "public" as const
            : "crate" as const,
          ...(structuralShapeNames.size > 0
            ? { attrs: ["#[doc(hidden)]"] }
            : {}),
        }]),
    ...(initializerFacadeModel === undefined
      ? []
      : [{
          kind: "mod-decl" as const,
          name: initializerFacadeModuleName,
          visibility: "public" as const,
          attrs: ["#[doc(hidden)]"],
        }]),
    ...[...topLevelModuleNames].sort(compareNames).map((name): RustItem => {
      const sourcePublic = publicTopLevelModuleNames.has(name);
      const implementationPublic = publicImplementationModuleNames.has(name);
      return {
        kind: "mod-decl",
        name,
        visibility: sourcePublic || implementationPublic ? "public" : "crate",
        ...(implementationPublic && !sourcePublic
          ? { attrs: ["#[doc(hidden)]"] }
          : {}),
      };
    }),
    ...facades.rootItems,
  ];
  return Object.freeze({
    component,
    initializerFacadeModuleName,
    sources: facades.sources,
    libraryItems: Object.freeze(libraryItems),
    ...(programErrorModel === undefined ? {} : { programErrorModel }),
    ...(structuralShapeModel === undefined ? {} : { structuralShapeModel }),
    ...(initializerFacadeModel === undefined ? {} : { initializerFacadeModel }),
    structuralShapeNames: Object.freeze(structuralShapeNames),
    syntheticModules: facades.syntheticModules,
  });
}

export function materializeRustSourcePackageCrateArtifacts(
  input: RustPlanningContext,
  plan: RustSourcePackageCrateContentPlan,
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  facadePlan: RustSourcePackageFacadePlan,
  diagnostics: TargetDiagnostic[],
  options: {
    readonly prefix: RustCrateArtifactPrefix;
    readonly manifest?: CargoManifestPlan;
    readonly additionalLibraryItems?: readonly RustItem[];
  },
): readonly RustPlannedArtifact[] | undefined {
  const artifacts: RustPlannedArtifact[] = options.manifest === undefined
    ? []
    : [{
        kind: "project",
        path: cargoManifestPath(options.prefix),
        manifest: options.manifest,
      }];
  artifacts.push(rustSourceArtifact(
    prefixedPath(options.prefix, "src/lib.rs"),
    createRustSourceFile([
      ...plan.libraryItems,
      ...(options.additionalLibraryItems ?? []),
    ]),
  ));
  if (plan.programErrorModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      prefixedPath(options.prefix, `src/${plan.component.programModuleName}.rs`),
      plan.programErrorModel,
    ));
  }
  if (plan.structuralShapeModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      prefixedPath(options.prefix, `src/${plan.component.structuralShapesModuleName}.rs`),
      plan.structuralShapeModel,
    ));
  }
  if (plan.initializerFacadeModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      prefixedPath(
        options.prefix,
        `src/${plan.initializerFacadeModuleName}.rs`,
      ),
      plan.initializerFacadeModel,
    ));
  }
  const componentIdentities = new Map([...identities].filter(([, identity]) =>
    identity.componentId === plan.component.componentId));
  const sourceArtifacts = planSyntheticModuleArtifacts(
    componentIdentities,
    plan.syntheticModules,
    facadePlan.publicModuleNamesByComponent.get(plan.component.componentId) ?? new Set(),
    plan.component.publicImplementationModuleNames,
  );
  for (const source of [...plan.sources].sort((left, right) =>
    compareNames(left.moduleName, right.moduleName))) {
    const identity = identities.get(input.program.source.ast.getFileName(source.sourceFile));
    if (identity === undefined || identity.componentId !== plan.component.componentId) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_OUTPUT_IDENTITY_MISSING",
        `Planned Rust source module '${source.moduleName}' has no exact component-owned output identity.`,
      ));
      continue;
    }
    sourceArtifacts.push(rustSourceArtifact(identity.artifactPath, source.model));
  }
  sourceArtifacts.sort((left, right) => compareNames(left.path, right.path));
  artifacts.push(...sourceArtifacts.map((artifact) => ({
    ...artifact,
    path: prefixedPath(options.prefix, artifact.path),
  })));
  return diagnostics.length === 0 ? Object.freeze(artifacts) : undefined;
}

export function planRustSourcePackageCargo(
  rootManifest: CargoManifestPlan,
  components: readonly RustSourcePackageComponentPlan[],
  diagnostics: TargetDiagnostic[],
): RustSourcePackageCargoPlan | undefined {
  const root = components.find((component) => component.root);
  if (root === undefined) {
    diagnostics.push(crateDiagnostic(
      "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISSING",
      "Rust Cargo planning has no exact root source-package component.",
    ));
    return undefined;
  }
  const componentById = new Map(components.map((component) =>
    [component.componentId, component] as const));
  const externalComponents = components.filter((component) => !component.root);
  const runtimeNames = new Set(rootManifest.dependencies.map((dependency) => dependency.name));
  const componentIdByCrateName = new Map<string, string>();
  for (const component of externalComponents) {
    if (component.crateName === undefined || component.crateName === rootManifest.packageName ||
      runtimeNames.has(component.crateName)) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_CONFLICT",
        `Generated source-package component '${component.componentId}' has conflicting Rust crate identity '${String(component.crateName)}'.`,
      ));
      continue;
    }
    const existingComponentId = componentIdByCrateName.get(component.crateName);
    if (existingComponentId !== undefined) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_CONFLICT",
        `Source-package components '${existingComponentId}' and '${component.componentId}' share Rust crate identity '${component.crateName}'.`,
      ));
      continue;
    }
    componentIdByCrateName.set(component.crateName, component.componentId);
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  const dependencyFor = (
    component: RustSourcePackageComponentPlan,
    dependencyId: string,
  ): CargoDependency | undefined => {
    const dependency = componentById.get(dependencyId);
    if (dependency?.crateName === undefined) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_DEPENDENCY_MISSING",
        `Source-package component '${component.componentId}' has no exact generated dependency crate for '${dependencyId}'.`,
      ));
      return undefined;
    }
    return {
      name: dependency.crateName,
      path: component.root
        ? `crates/${dependency.crateName}`
        : `../${dependency.crateName}`,
    };
  };
  const rootDependencies = mergeCargoDependencies(
    rootManifest.dependencies,
    root.dependencyComponentIds.flatMap((dependencyId) => {
      const dependency = dependencyFor(root, dependencyId);
      return dependency === undefined ? [] : [dependency];
    }),
    diagnostics,
  );
  const externalManifestsByComponentId = new Map<string, {
    readonly directory: `crates/${string}`;
    readonly manifest: CargoManifestPlan;
  }>();
  for (const component of externalComponents) {
    const crateName = component.crateName;
    if (crateName === undefined) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_MISSING",
        `Source-package component '${component.componentId}' has no exact Rust crate identity.`,
      ));
      continue;
    }
    const componentDependencies = component.dependencyComponentIds.flatMap((dependencyId) => {
      const dependency = dependencyFor(component, dependencyId);
      return dependency === undefined ? [] : [dependency];
    });
    const dependencies = mergeCargoDependencies(
      rootManifest.dependencies.map(({ name, path }) => ({ name, path })),
      componentDependencies,
      diagnostics,
    );
    externalManifestsByComponentId.set(component.componentId, Object.freeze({
      directory: `crates/${crateName}`,
      manifest: Object.freeze({
        packageName: crateName,
        edition: rootManifest.edition,
        outputType: "lib",
        dependencies,
      }),
    }));
  }
  if (diagnostics.length > 0) {
    return undefined;
  }
  return Object.freeze({
    rootManifest: Object.freeze({
      ...rootManifest,
      dependencies: rootDependencies,
      workspace: {
        members: Object.freeze([...externalManifestsByComponentId.values()]
          .map((entry) => entry.directory)
          .sort(compareNames)),
      },
    }),
    externalManifestsByComponentId: new Map(externalManifestsByComponentId),
  });
}

interface AppliedRustSourcePackageFacades {
  readonly sources: readonly PlannedRustSourceFile[];
  readonly rootItems: readonly RustItem[];
  readonly syntheticModules: ReadonlyMap<string, RustSourceFileModel>;
}

function applyRustSourcePackageFacades(
  sources: readonly PlannedRustSourceFile[],
  exports: readonly RustSourcePackageFacadeExport[],
): AppliedRustSourcePackageFacades {
  const itemsByModule = new Map<string, RustItem[]>();
  for (const exported of exports) {
    const facadeModuleName = exported.facadeModuleSegments.join("::");
    if (facadeModuleName === exported.implementationModuleName &&
      exported.facadeName === exported.implementationName) {
      continue;
    }
    const items = itemsByModule.get(facadeModuleName) ?? [];
    items.push({
      kind: "use",
      visibility: "public",
      path: `crate::${exported.implementationModuleName}::${exported.implementationName}`,
      ...(exported.facadeName === exported.implementationName
        ? {}
        : { alias: exported.facadeName }),
    });
    itemsByModule.set(facadeModuleName, items);
  }
  for (const [moduleName, items] of itemsByModule) {
    itemsByModule.set(moduleName, distinctRustUseItems(items));
  }
  const sourceByModule = new Map(sources.map((source) => [source.moduleName, source] as const));
  const updatedSources = sources.map((source): PlannedRustSourceFile => {
    const facadeItems = itemsByModule.get(source.moduleName);
    if (facadeItems === undefined || facadeItems.length === 0) {
      return source;
    }
    itemsByModule.delete(source.moduleName);
    return Object.freeze({
      ...source,
      model: createRustSourceFile([...source.model.items, ...facadeItems]),
    });
  });
  const rootItems = Object.freeze(itemsByModule.get("") ?? []);
  itemsByModule.delete("");
  const syntheticModules = new Map([...itemsByModule]
    .filter(([moduleName]) => !sourceByModule.has(moduleName))
    .map(([moduleName, items]) => [moduleName, createRustSourceFile(items)] as const));
  return Object.freeze({
    sources: Object.freeze(updatedSources),
    rootItems,
    syntheticModules,
  });
}

function planRustInitializerFacadeModule(
  sources: readonly PlannedRustSourceFile[],
  initializers: RustSourcePackageInitializerPlan,
  componentId: string,
  diagnostics: TargetDiagnostic[],
): RustSourceFileModel | undefined {
  const sourceByFile = new Map(sources.map((source) => [source.sourceFile, source] as const));
  const items: RustItem[] = [];
  for (const contract of [...initializers.byFileName.values()]
    .filter((entry) => entry.componentId === componentId)
    .sort((left, right) => compareNames(left.facadeFunctionName, right.facadeFunctionName))) {
    const source = sourceByFile.get(contract.sourceFile);
    const initialization = source?.moduleInitialization;
    const errorContractMatches = contract.fallible
      ? initialization?.errorBoundary?.componentId === contract.componentId
      : initialization?.errorBoundary === undefined;
    if (source === undefined || initialization === undefined ||
      initialization.functionName !== contract.implementationFunctionName ||
      initialization.asynchronous !== contract.asynchronous || !errorContractMatches) {
      diagnostics.push({
        ...crateDiagnostic(
          "RUST_SOURCE_PACKAGE_INITIALIZER_CONTRACT_MISMATCH",
          `Source module '${contract.fileName}' does not implement its exact package initializer contract.`,
        ),
        sourceNode: contract.sourceFile,
      });
      continue;
    }
    items.push({
      kind: "use",
      visibility: "public",
      path: `crate::${source.moduleName}::${initialization.functionName}`,
      alias: contract.facadeFunctionName,
    });
  }
  return items.length === 0 ? undefined : createRustSourceFile(items);
}

function planSyntheticModuleArtifacts(
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  facadeModules: ReadonlyMap<string, RustSourceFileModel>,
  publicModuleNames: ReadonlySet<string>,
  publicImplementationModuleNames: ReadonlySet<string>,
): RustPlannedSourceArtifact[] {
  const authoredModules = new Set(
    [...identities.values()].map((identity) => identity.moduleName),
  );
  const allModules = new Set([...authoredModules, ...facadeModules.keys()]);
  const childNamesByParent = new Map<string, Set<string>>();
  for (const moduleName of allModules) {
    const segments = moduleName.split("::");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const parent = segments.slice(0, depth).join("::");
      const childName = segments[depth];
      if (childName === undefined) {
        continue;
      }
      const children = childNamesByParent.get(parent) ?? new Set<string>();
      children.add(childName);
      childNamesByParent.set(parent, children);
    }
  }
  const syntheticModuleNames = new Set([
    ...facadeModules.keys(),
    ...childNamesByParent.keys(),
  ]);
  return [...syntheticModuleNames]
    .filter((moduleName) => !authoredModules.has(moduleName))
    .sort(compareNames)
    .map((moduleName) => {
      const children = childNamesByParent.get(moduleName) ?? new Set<string>();
      const facade = facadeModules.get(moduleName);
      return rustSourceArtifact(
        `src/${moduleName.split("::").join("/")}.rs`,
        createRustSourceFile([
          ...[...children].sort(compareNames).map((name): RustItem => {
            const sourcePublic = publicModuleNames.has(`${moduleName}::${name}`);
            const implementationPublic = publicImplementationModuleNames.has(
              `${moduleName}::${name}`,
            );
            return {
              kind: "mod-decl",
              name,
              visibility: sourcePublic || implementationPublic ? "public" : "crate",
              ...(implementationPublic && !sourcePublic
                ? { attrs: ["#[doc(hidden)]"] }
                : {}),
            };
          }),
          ...(facade?.items ?? []),
        ]),
      );
    });
}

function distinctRustUseItems(items: readonly RustItem[]): RustItem[] {
  const byIdentity = new Map<string, RustItem>();
  for (const item of items) {
    if (item.kind === "use") {
      byIdentity.set(`${item.path.length}:${item.path}${item.alias ?? ""}`, item);
    }
  }
  return [...byIdentity.values()].sort((left, right) => {
    if (left.kind !== "use" || right.kind !== "use") {
      return 0;
    }
    return compareNames(left.path, right.path) ||
      compareNames(left.alias ?? "", right.alias ?? "");
  });
}

function mergeCargoDependencies(
  base: readonly CargoDependency[],
  added: readonly CargoDependency[],
  diagnostics: TargetDiagnostic[],
): readonly CargoDependency[] {
  const byName = new Map<string, CargoDependency>();
  for (const dependency of [...base, ...added]) {
    const existing = byName.get(dependency.name);
    if (existing !== undefined &&
      (existing.path !== dependency.path || existing.registryPatch !== dependency.registryPatch)) {
      diagnostics.push(crateDiagnostic(
        "RUST_SOURCE_PACKAGE_CRATE_DEPENDENCY_CONFLICT",
        `Cargo dependency '${dependency.name}' has contradictory source-package and runtime paths.`,
      ));
      continue;
    }
    byName.set(dependency.name, dependency);
  }
  return Object.freeze([...byName.values()].sort((left, right) =>
    compareNames(left.name, right.name)));
}

function prefixedPath(prefix: RustCrateArtifactPrefix, path: string): string {
  return prefix.length === 0 ? path : `${prefix}/${path}`;
}

function rustSourceArtifact(path: string, model: RustSourceFileModel): RustPlannedSourceArtifact {
  return { kind: "source", path, model };
}

function cargoManifestPath(
  prefix: RustCrateArtifactPrefix,
): "Cargo.toml" | `crates/${string}/Cargo.toml` {
  return prefix === "" ? "Cargo.toml" : `${prefix}/Cargo.toml`;
}

function crateDiagnostic(code: string, message: string): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.backend.source-package-crates"],
  };
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

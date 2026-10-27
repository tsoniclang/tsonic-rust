import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustSourceFileOutputIdentity } from "../../../target-model/names/source-output-identities.js";
import type { CargoManifestPlan } from "../../../target-model/project/cargo.js";
import type { RustSourcePackageCargoPlan } from "../../../target-model/records/program/source-package-crates.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustPlannedArtifact } from "../../artifact-model/output.js";
import { createRustSourceFile, type RustItem, type RustSourceFileModel } from "../../target-ast/syntax/nodes.js";
import { applyRustSealedTypeVisibility } from "../../target-ast/normalization/sealed-type-visibility.js";
import type { RustPlanningContext } from "../context.js";
import { planRustStructuralShapeModule } from "../objects/structural-shapes.js";
import { planRustProgramErrorModule } from "./errors.js";
import { planRustDispatchContextRoots } from "./dispatch-contexts.js";
import type { PlannedRustSourceFile } from "./source-file.js";
import { createRustSourcePackageTypeRenderingContext } from "./source-package-components.js";
import type {
  RustSourcePackageComponentPlan, RustSourcePackageFacadeExport, RustSourcePackageFacadePlan,
  RustSourcePackageInitializerPlan,
} from "../../../target-model/records/program/source-packages.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/errors/source-package-errors.js";
import { createRustCrateRootSourceFile } from "../project/foundation.js";
import { rustItemsReferenceModuleAlias } from "../../target-ast/syntax/module-references.js";
import { rustRuntimeAliasImports, rustRuntimeAliasUseItems } from "./plan-context.js";

export interface RustSourcePackageCrateContentPlan {
  readonly component: RustSourcePackageComponentPlan;
  readonly initializerFacadeModuleName: string;
  readonly sources: readonly PlannedRustSourceFile[];
  readonly libraryItems: readonly RustItem[];
  readonly programModel?: RustSourceFileModel;
  readonly structuralShapeModel?: RustSourceFileModel;
  readonly initializerFacadeModel?: RustSourceFileModel;
  readonly structuralShapeNames: ReadonlySet<string>;
  readonly syntheticModules: ReadonlyMap<string, RustSourceFileModel>;
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
    failRustPlannerInvariant("An admitted source component requires its native initializer facade identity.");
  }
  const componentExports = facadePlan.exportsByComponentId.get(component.componentId) ?? [];
  const facades = applyRustSourcePackageFacades(sources, componentExports);
  const signature = input.program.records.signatureVisibility.get(component.componentId);
  if (signature === undefined) failRustPlannerInvariant("An admitted source component requires its sealed native public signature closure.");
  const structuralShapeNames = signature.structuralShapes;
  const errorDomain = sourcePackageErrors.domainsByComponentId.get(component.componentId);
  if (errorDomain === undefined) {
    failRustPlannerInvariant("An admitted source component requires its native error domain.");
  }
  const structuralShapeModel = planRustStructuralShapeModule(
    input,
    moduleNameByFileName,
    externalCrateNameByFileName,
    externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    component.crateName,
    component.structuralShapesModuleName,
    component.componentId,
    sourcePackageErrors,
    errorDomain.errorDomain === "project" ? component.programModuleName : undefined,
    structuralShapeNames,
    diagnostics,
  );
  const programErrorModel = planRustProgramErrorModule(
    input,
    errorDomain,
  );
  const dispatchRoots = planRustDispatchContextRoots(createRustSourcePackageTypeRenderingContext(
    input, component, sourcePackageErrors,
    { moduleNameByFileName, externalCrateNameByFileName, externalItemPathByIdentity, externalStructuralShapeModuleByFileName },
  ), errorDomain, component.programModuleName);
  if (dispatchRoots === undefined) return undefined;
  const programModel = programErrorModel === undefined && dispatchRoots.length === 0
    ? undefined : createRustSourceFile([...(programErrorModel?.items ?? []), ...dispatchRoots], programErrorModel?.innerAttrs ?? []);
  const initializerFacadeModel = planRustInitializerFacadeModule(
    packageInitializers,
    component.componentId,
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
      failRustPlannerInvariant("An admitted source module requires its top-level native module identity.");
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
    ...(programModel === undefined
      ? []
      : [{
          kind: "mod-decl" as const,
          name: component.programModuleName,
          visibility: "public" as const,
          attrs: [rustHiddenAttribute],
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
            ? { attrs: [rustHiddenAttribute] }
            : {}),
        }]),
    ...(initializerFacadeModel === undefined
      ? []
      : [{
          kind: "mod-decl" as const,
          name: initializerFacadeModuleName,
          visibility: "public" as const,
          attrs: [rustHiddenAttribute],
        }]),
    ...[...topLevelModuleNames].sort(compareNames).map((name): RustItem => {
      const sourcePublic = publicTopLevelModuleNames.has(name);
      const implementationPublic = publicImplementationModuleNames.has(name);
      return {
        kind: "mod-decl",
        name,
        visibility: sourcePublic || implementationPublic ? "public" : "crate",
        ...(implementationPublic && !sourcePublic
          ? { attrs: [rustHiddenAttribute] }
          : {}),
      };
    }),
    ...facades.rootItems,
  ];
  const visibleModels = new Map([
    ...facades.sources.map(source => [source.moduleName, source.model] as const),
    ...facades.syntheticModules,
    ...(structuralShapeModel === undefined ? [] : [[component.structuralShapesModuleName, structuralShapeModel] as const]),
    ...(programModel === undefined ? [] : [[component.programModuleName, programModel] as const]),
    ...(initializerFacadeModel === undefined ? [] : [[initializerFacadeModuleName, initializerFacadeModel] as const]),
  ].map(([name, model]) => [name, applyRustSealedTypeVisibility(model,
    signature.requiredByModule.get(name) ?? new Set<string>())] as const));
  return Object.freeze({
    component,
    initializerFacadeModuleName,
    sources: facades.sources.map(source => ({ ...source, model: visibleModels.get(source.moduleName)! })),
    libraryItems: Object.freeze(libraryItems),
    ...(programModel === undefined ? {} : { programModel: visibleModels.get(component.programModuleName)! }),
    ...(structuralShapeModel === undefined ? {} : { structuralShapeModel: visibleModels.get(component.structuralShapesModuleName)! }),
    ...(initializerFacadeModel === undefined ? {} : { initializerFacadeModel: visibleModels.get(initializerFacadeModuleName)! }),
    structuralShapeNames: Object.freeze(structuralShapeNames),
    syntheticModules: new Map([...facades.syntheticModules].map(([name]) => [name, visibleModels.get(name)!])),
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
  const emission = input.program.records.programEmission.get();
  if (emission === undefined) failRustPlannerInvariant("An admitted crate requires its native program configuration.");
  const artifacts: RustPlannedArtifact[] = options.manifest === undefined
    ? []
    : [{
        kind: "project",
        path: cargoManifestPath(options.prefix),
        manifest: options.manifest,
      }];
  artifacts.push(rustSourceArtifact(
    prefixedPath(options.prefix, "src/lib.rs"),
    createRustCrateRootSourceFile(emission.configuration.foundation, [
      ...plan.libraryItems,
      ...rustRuntimeAliasUseItems(new Set([...rustRuntimeAliasImports.keys()].filter(alias =>
        rustItemsReferenceModuleAlias(options.additionalLibraryItems ?? [], alias))),
      plan.component.errorDomain === "project" ? plan.component.programModuleName : undefined),
      ...(options.additionalLibraryItems ?? []),
    ]),
  ));
  if (plan.programModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      prefixedPath(options.prefix, `src/${plan.component.programModuleName}.rs`),
      plan.programModel,
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
      failRustPlannerInvariant("An admitted source module requires its component-owned output identity.", source.sourceFile);
    }
    sourceArtifacts.push(rustSourceArtifact(`src/${identity.moduleSegments.join("/")}.rs`, source.model));
  }
  sourceArtifacts.sort((left, right) => compareNames(left.path, right.path));
  artifacts.push(...sourceArtifacts.map((artifact) => ({
    ...artifact,
    path: prefixedPath(options.prefix, artifact.path),
  })));
  return diagnostics.length === 0 ? Object.freeze(artifacts) : undefined;
}

export function planRustSourcePackageCargo(input: RustPlanningContext): RustSourcePackageCargoPlan | undefined {
  const selected = input.program.records.packageCargo.get();
  if (selected === undefined) failRustPlannerInvariant("An admitted program requires its selected native package manifests.");
  return selected.kind === "generated" ? selected.plan : undefined;
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
  initializers: RustSourcePackageInitializerPlan,
  componentId: string,
): RustSourceFileModel | undefined {
  const items: RustItem[] = [];
  for (const contract of [...initializers.byFileName.values()]
    .filter((entry) => entry.componentId === componentId)
    .sort((left, right) => compareNames(left.facadeFunctionName, right.facadeFunctionName))) {
    items.push({
      kind: "use",
      visibility: "public",
      path: `crate::${contract.implementationModuleName}::${contract.implementationFunctionName}`,
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
                ? { attrs: [rustHiddenAttribute] }
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

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

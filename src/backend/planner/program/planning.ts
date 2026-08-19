import type { SourceFile } from "@tsonic/tsts";
import { resolve } from "node:path";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  KindFunctionDeclaration,
  Node_Name,
} from "@tsonic/target-api/source";
import { readRustCrateName, readRustOutputType } from "../../../options/rust-target-options.js";
import { cargoCrateAttributeName } from "../../../providers/model/cargo-reference.js";
import { isRustUnitCarrier } from "../../../policy/types/target-types.js";
import { createRustSourceFile } from "../../rust-ast/nodes.js";
import type { RustItem } from "../../rust-ast/nodes.js";
import { planRustCargoProject } from "../project/cargo.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustSourceCallableReturnFactKey } from "../../../analysis/facts/keys.js";
import type { RustPlanningContext } from "../context.js";
import { registerRustProviderErrorCarrier } from "../context.js";
import { reconstructRustSourceFiles } from "../artifacts/reconstruction.js";
import {
  planRustCrateInitializer,
  planRustModuleInitializers,
} from "./module-initialization.js";
import {
  allocateRustComponentSupportModuleName,
  planRustSourceOutputIdentities,
} from "../../../analysis/program/source-output-identities.js";
import { planRustProgramErrorModule } from "./errors.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import { planRustStructuralShapeModule } from "../objects/structural-shapes.js";
import { rustPublicSignatureTypeNames } from "../../rust-ast/source-style.js";
import type {
  RustArtifactPlanResult,
  RustPlannedArtifact,
} from "../../artifacts/model.js";
import { planRustSourcePackageFacades } from "./source-package-facades.js";
import type { RustSourcePackageFacadeExport } from "./source-package-facades.js";
import type { PlannedRustSourceFile } from "./source-file.js";
import {
  planRustSourcePackageInitializers,
  type RustSourcePackageInitializerPlan,
} from "./source-package-initializers.js";
import { planRustExternalSourcePackageErrors } from "./source-package-errors.js";

export function planRustArtifacts(input: RustPlanningContext): RustArtifactPlanResult {
  const diagnostics: TargetDiagnostic[] = [];
  const identityPlan = planRustSourceOutputIdentities(input);
  if (identityPlan.kind === "rejected") {
    return { artifacts: [], diagnostics: [...diagnostics, ...identityPlan.diagnostics] };
  }
  const moduleNameByFileName = new Map(
    [...identityPlan.identities].map(([fileName, identity]) => [fileName, identity.moduleName] as const),
  );
  const externalCrateNameByFileName = new Map(
    [...identityPlan.identities]
      .filter(([, identity]) => identity.externalCrateName !== undefined)
      .map(([fileName, identity]) => [fileName, identity.externalCrateName!] as const),
  );
  const localIdentities = new Map(
    [...identityPlan.identities].filter(([, identity]) =>
      identity.externalCrateName === undefined),
  );
  const localSourceFileNames = Object.freeze(new Set(localIdentities.keys()));
  const facadeResult = planRustSourcePackageFacades(input, identityPlan.identities);
  diagnostics.push(...facadeResult.diagnostics);
  if (facadeResult.plan === undefined || diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const facadePlan = facadeResult.plan;
  const initializerResult = planRustSourcePackageInitializers(input, identityPlan.identities);
  diagnostics.push(...initializerResult.diagnostics);
  if (initializerResult.plan === undefined || diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const packageInitializers = initializerResult.plan;
  const externalErrorPlan = planRustExternalSourcePackageErrors(
    input,
    identityPlan.identities,
    facadePlan.rootComponentId,
  );
  diagnostics.push(...externalErrorPlan.diagnostics);
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const localProgramErrorDefinitions = input.projectTypes.programErrorDefinitions
    .filter((definition) => localSourceFileNames.has(definition.fileName));
  const localErrorDomain = localProgramErrorDefinitions.length === 0 &&
      externalErrorPlan.errors.length === 0
    ? "runtime" as const
    : "project" as const;
  const structuralShapesModuleName = allocateRustComponentSupportModuleName(
    identityPlan.identities,
    facadePlan.rootComponentId,
    "shapes",
  );
  const externalStructuralShapeModuleByFileName = new Map(
    [...identityPlan.identities].flatMap(([fileName, identity]) => {
      if (identity.externalCrateName === undefined) {
        return [];
      }
      const moduleName = allocateRustComponentSupportModuleName(
        identityPlan.identities,
        identity.componentId,
        "shapes",
      );
      return [[fileName, `${identity.externalCrateName}::${moduleName}`] as const];
    }),
  );
  const programModuleName = allocateRustComponentSupportModuleName(
    identityPlan.identities,
    facadePlan.rootComponentId,
    "program",
    [structuralShapesModuleName],
  );
  const initializerFacadeModuleName = packageInitializers.facadeModuleNameByComponent.get(
    facadePlan.rootComponentId,
  );
  if (initializerFacadeModuleName === undefined) {
    diagnostics.push({
      code: "RUST_SOURCE_PACKAGE_INITIALIZER_COMPONENT_MISSING",
      category: "error",
      source: "tsonic-rust",
      message: "The root source-package component has no exact initializer facade identity.",
      evidence: ["target.capability=rust.backend.source-package-initialization"],
    });
    return { artifacts: [], diagnostics };
  }
  const crateInitializerFunctionName = allocateRustComponentSupportModuleName(
    identityPlan.identities,
    facadePlan.rootComponentId,
    "initialize",
    [structuralShapesModuleName, programModuleName, initializerFacadeModuleName],
  );
  const plannedSources = reconstructRustSourceFiles(
    input,
    identityPlan.identities,
    facadePlan.externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    facadePlan.publicModuleNames,
    facadePlan.publicImplementationItemIdentities,
    localErrorDomain,
    programModuleName,
    structuralShapesModuleName,
    diagnostics,
  );
  if (plannedSources === undefined) {
    return { artifacts: [], diagnostics };
  }
  const rootPlannedSources = plannedSources.filter((source) =>
    identityPlan.identities.get(input.ast.getFileName(source.sourceFile))?.componentId ===
      facadePlan.rootComponentId);
  const facades = applyRustSourcePackageFacades(
    rootPlannedSources,
    facadePlan.rootExports,
  );
  const structuralShapePathPrefix = `crate::${structuralShapesModuleName}::`;
  const publicStructuralShapeNames = new Set(facades.sources.flatMap((source) =>
    rustPublicSignatureTypeNames(source.model)
      .filter((name) => name.startsWith(structuralShapePathPrefix))
      .map((name) => name.slice(structuralShapePathPrefix.length))));
  const structuralShapeModel = planRustStructuralShapeModule(
    input,
    moduleNameByFileName,
    externalCrateNameByFileName,
    facadePlan.externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    structuralShapesModuleName,
    facadePlan.rootComponentId,
    publicStructuralShapeNames,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  // Activation: a runtime crate is a dependency only when planned code
  // references it (directly or through a declared alias). Surface-selected
  // crates without carrier/operation use stay out of the manifest.
  const cargoProject = planRustCargoProject(input.target, input.paths, input.runtimeReferences);
  if (cargoProject.project === undefined) {
    return { artifacts: [], diagnostics: [...diagnostics, ...cargoProject.diagnostics] };
  }

  const outputType = readRustOutputType(input.target);
  const entryFunction = outputType === "bin"
    ? resolveBinaryEntry(input, moduleNameByFileName, diagnostics)
    : undefined;
  const initializationRoots = outputType === "bin"
    ? entryFunction === undefined ? [] : [entryFunction.sourceFile]
    : resolveLibraryInitializationRoots(
        input,
        facadePlan.rootExports,
        packageInitializers,
        facadePlan.rootComponentId,
        diagnostics,
      );
  const moduleInitializers = initializationRoots.length === 0
    ? []
    : planRustModuleInitializers(
        input,
        facades.sources,
        initializationRoots,
        packageInitializers,
        diagnostics,
      );

  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const sortedSources = [...facades.sources].sort((left, right) =>
    left.moduleName.localeCompare(right.moduleName, "en"));
  const sortedTopLevelModuleNames = [...new Set(
    [...identityPlan.identities.values()]
      .filter((identity) => identity.externalCrateName === undefined)
      .map((identity) => identity.moduleSegments[0]!),
  )].sort(compareRustArtifactNames);
  const binaryEntryExportName = entryFunction === undefined
    ? undefined
    : allocateRustRootSupportItemName(
        "tsonic_entry",
        [
          ...sortedTopLevelModuleNames,
          programModuleName,
          structuralShapesModuleName,
          initializerFacadeModuleName,
          crateInitializerFunctionName,
          ...facades.rootItems.flatMap((item) =>
            item.kind === "use"
              ? [item.alias ?? item.path.slice(item.path.lastIndexOf("::") + 2)]
              : []),
        ],
      );
  const activeCrates = new Set(input.runtimeReferences.flatMap((reference) => {
    const crate = reference.attributes?.[cargoCrateAttributeName];
    return typeof crate === "string" ? [crate] : [];
  }));
  const activeEpilogues = input.providerSemantics.binaryEpilogues.filter((epilogue) =>
    activeCrates.has(epilogue.requiredCrate));
  for (const epilogue of activeEpilogues) {
    if (epilogue.errorBoundary === "provider-native") {
      registerRustProviderErrorCarrier(input, epilogue.errorCarrier);
    }
  }
  const programErrorModel = planRustProgramErrorModule(
    input,
    moduleNameByFileName,
    localSourceFileNames,
    externalErrorPlan.errors,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const errorDomain = localErrorDomain;
  const crateInitializer = planRustCrateInitializer(
    moduleInitializers ?? [],
    crateInitializerFunctionName,
    programErrorModel === undefined
      ? "tsonic_rust_runtime::TsonicResult"
      : `crate::${programModuleName}::TsonicResult`,
    errorDomain,
  );
  const initializerFacadeModel = planRustInitializerFacadeModule(
    facades.sources,
    packageInitializers,
    facadePlan.rootComponentId,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const artifacts: RustPlannedArtifact[] = cargoProject.project.kind === "generated"
    ? [{
        kind: "project",
        path: "Cargo.toml",
        manifest: cargoProject.project.manifest,
      }]
    : [];
  const libraryModel = createRustSourceFile(
    [
      ...(programErrorModel === undefined
        ? []
        : [{
            kind: "mod-decl" as const,
            name: programModuleName,
            visibility: "public" as const,
            attrs: ["#[doc(hidden)]"],
          }]),
      ...(structuralShapeModel === undefined
        ? []
        : [{
            kind: "mod-decl" as const,
            name: structuralShapesModuleName,
            visibility: "public" as const,
            attrs: ["#[doc(hidden)]"],
          }]),
      ...(initializerFacadeModel === undefined
        ? []
        : [{
            kind: "mod-decl" as const,
            name: initializerFacadeModuleName,
            visibility: "public" as const,
            attrs: ["#[doc(hidden)]"],
          }]),
      ...sortedTopLevelModuleNames.map((name): RustItem => ({
        kind: "mod-decl",
        name,
        visibility: facadePlan.publicTopLevelModules.has(name) ? "public" : "crate",
      })),
      ...facades.rootItems,
      ...(entryFunction === undefined || binaryEntryExportName === undefined
        ? []
        : [{
            kind: "use" as const,
            visibility: "public" as const,
            path: `crate::${entryFunction.moduleName}::${entryFunction.functionName}`,
            alias: binaryEntryExportName,
          }]),
      ...(crateInitializer === undefined ? [] : [crateInitializer.item]),
    ],
  );
  artifacts.push(rustSourceArtifact("src/lib.rs", libraryModel));
  if (programErrorModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      `src/${programModuleName}.rs`,
      programErrorModel,
    ));
  }
  if (structuralShapeModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      `src/${structuralShapesModuleName}.rs`,
      structuralShapeModel,
    ));
  }
  if (initializerFacadeModel !== undefined) {
    artifacts.push(rustSourceArtifact(
      `src/${initializerFacadeModuleName}.rs`,
      initializerFacadeModel,
    ));
  }
  const sourceArtifacts: RustPlannedArtifact[] = planSyntheticModuleArtifacts(
    localIdentities,
    facades.syntheticModules,
    facadePlan.publicModuleNames,
  );
  for (const source of sortedSources) {
    const identity = identityPlan.identities.get(input.ast.getFileName(source.sourceFile));
    if (identity === undefined) {
      diagnostics.push({
        code: "RUST_SOURCE_OUTPUT_IDENTITY_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: `Planned Rust source module '${source.moduleName}' has no prepared output identity.`,
        evidence: ["target.capability=rust.backend.source-output-identity"],
      });
      continue;
    }
    sourceArtifacts.push(rustSourceArtifact(
      identity.artifactPath,
      source.model,
    ));
  }
  sourceArtifacts.sort((left, right) => compareRustArtifactNames(left.path, right.path));
  artifacts.push(...sourceArtifacts);
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  if (outputType === "bin" && entryFunction !== undefined) {
    const crateName = readRustCrateName(input.target);
    const entryCall = {
      kind: "call" as const,
      path: `${crateName}::${binaryEntryExportName!}`,
      args: [],
    };
    const entryExecution = entryFunction.async
      ? {
          kind: "call" as const,
          path: "tsonic_rust_runtime::block_on",
          args: [entryCall],
        }
      : entryCall;
    const initializationStatements = crateInitializer === undefined
      ? []
      : [{
          kind: "expr" as const,
          expr: crateInitializer.fallible
            ? {
              kind: "try" as const,
              errorDomain,
              expr: crateInitializer.asynchronous
                  ? {
                      kind: "call" as const,
                      path: "tsonic_rust_runtime::block_on",
                      args: [{
                        kind: "call" as const,
                        path: `${crateName}::${crateInitializer.functionName}`,
                        args: [],
                      }],
                    }
                  : {
                      kind: "call" as const,
                      path: `${crateName}::${crateInitializer.functionName}`,
                      args: [],
                    },
              }
            : crateInitializer.asynchronous
              ? {
                  kind: "call" as const,
                  path: "tsonic_rust_runtime::block_on",
                  args: [{
                    kind: "call" as const,
                    path: `${crateName}::${crateInitializer.functionName}`,
                    args: [],
                  }],
                }
              : {
                  kind: "call" as const,
                  path: `${crateName}::${crateInitializer.functionName}`,
                  args: [],
                },
        }];
    const epilogueStatements = activeEpilogues.map((epilogue) => {
      const call = { kind: "call" as const, path: epilogue.path, args: [] };
      if (epilogue.isFallible !== true) {
        return { kind: "expr" as const, expr: call };
      }
      return {
        kind: "expr" as const,
        expr: applyRustErrorBoundary(
          call,
          epilogue.errorBoundary,
          errorDomain,
          epilogue.errorCarrier,
        ),
      };
    });
    const mainFallible = entryFunction.fallible ||
      crateInitializer?.fallible === true ||
      activeEpilogues.some((epilogue) => epilogue.isFallible === true);
    const entryStatement = {
      kind: "expr" as const,
      expr: entryFunction.fallible
        ? { kind: "try" as const, expr: entryExecution, errorDomain }
        : entryExecution,
    };
    const completionStatements = mainFallible
      ? [{ kind: "tail" as const, expr: { kind: "path" as const, path: "Ok(())" } }]
      : [];
    const mainItem: RustItem = {
      kind: "function",
      name: "main",
      visibility: "private",
      params: [],
      ...(mainFallible
        ? {
            returnType: {
              kind: "named" as const,
              path: programErrorModel === undefined
                ? "tsonic_rust_runtime::TsonicResult"
                : `${crateName}::${programModuleName}::TsonicResult`,
              typeArguments: [{ kind: "unit" as const }],
            },
            body: { statements: [...initializationStatements, entryStatement, ...epilogueStatements, ...completionStatements] },
          }
        : { body: { statements: [...initializationStatements, entryStatement, ...epilogueStatements] } }),
    };
    artifacts.push(rustSourceArtifact("src/main.rs", createRustSourceFile([mainItem])));
  }
  return { artifacts, diagnostics: [] };
}

function planSyntheticModuleArtifacts(
  identities: ReadonlyMap<string, import("../../../analysis/program/source-output-identities.js").RustSourceFileOutputIdentity>,
  facadeModules: ReadonlyMap<string, import("../../rust-ast/nodes.js").RustSourceFileModel>,
  publicModuleNames: ReadonlySet<string>,
): RustPlannedArtifact[] {
  const authoredModules = new Set(
    [...identities.values()].map((identity) => identity.moduleName),
  );
  const allModules = new Set([...authoredModules, ...facadeModules.keys()]);
  const childNamesByParent = new Map<string, Set<string>>();
  for (const moduleName of allModules) {
    const segments = moduleName.split("::");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const parent = segments.slice(0, depth).join("::");
      const children = childNamesByParent.get(parent) ?? new Set<string>();
      children.add(segments[depth]!);
      childNamesByParent.set(parent, children);
    }
  }
  const syntheticModuleNames = new Set([
    ...facadeModules.keys(),
    ...childNamesByParent.keys(),
  ]);
  return [...syntheticModuleNames]
    .filter((moduleName) => !authoredModules.has(moduleName))
    .sort(compareRustArtifactNames)
    .map((moduleName) => {
      const children = childNamesByParent.get(moduleName) ?? new Set<string>();
      const facade = facadeModules.get(moduleName);
      return rustSourceArtifact(
      `src/${moduleName.split("::").join("/")}.rs`,
      createRustSourceFile(
        [
          ...[...children]
          .sort(compareRustArtifactNames)
          .map((name): RustItem => ({
            kind: "mod-decl",
            name,
            visibility: publicModuleNames.has(`${moduleName}::${name}`) ? "public" : "crate",
          })),
          ...(facade?.items ?? []),
        ],
      ),
      );
    });
}

interface AppliedRustSourcePackageFacades {
  readonly sources: readonly PlannedRustSourceFile[];
  readonly rootItems: readonly RustItem[];
  readonly syntheticModules: ReadonlyMap<string, import("../../rust-ast/nodes.js").RustSourceFileModel>;
}

function planRustInitializerFacadeModule(
  sources: readonly PlannedRustSourceFile[],
  initializers: RustSourcePackageInitializerPlan,
  rootComponentId: string,
  diagnostics: TargetDiagnostic[],
): import("../../rust-ast/nodes.js").RustSourceFileModel | undefined {
  const sourceByFile = new Map(sources.map((source) => [source.sourceFile, source] as const));
  const items: RustItem[] = [];
  for (const contract of [...initializers.byFileName.values()]
    .filter((entry) => entry.componentId === rootComponentId)
    .sort((left, right) => compareRustArtifactNames(
      left.facadeFunctionName,
      right.facadeFunctionName,
    ))) {
    const source = sourceByFile.get(contract.sourceFile);
    const initialization = source?.moduleInitialization;
    if (source === undefined || initialization === undefined ||
      initialization.functionName !== contract.implementationFunctionName ||
      initialization.asynchronous !== contract.asynchronous ||
      initialization.fallible !== contract.fallible) {
      diagnostics.push({
        code: "RUST_SOURCE_PACKAGE_INITIALIZER_CONTRACT_MISMATCH",
        category: "error",
        source: "tsonic-rust",
        message: `Source module '${contract.fileName}' does not implement its exact package initializer contract.`,
        sourceNode: contract.sourceFile,
        evidence: ["target.capability=rust.backend.source-package-initialization"],
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

function distinctRustUseItems(items: readonly RustItem[]): RustItem[] {
  const byIdentity = new Map<string, RustItem>();
  for (const item of items) {
    if (item.kind !== "use") {
      continue;
    }
    byIdentity.set(`${item.path.length}:${item.path}${item.alias ?? ""}`, item);
  }
  return [...byIdentity.values()].sort((left, right) => {
    if (left.kind !== "use" || right.kind !== "use") {
      return 0;
    }
    return compareRustArtifactNames(left.path, right.path) ||
      compareRustArtifactNames(left.alias ?? "", right.alias ?? "");
  });
}

function compareRustArtifactNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function allocateRustRootSupportItemName(
  baseName: string,
  occupiedNames: readonly string[],
): string {
  const occupied = new Set(occupiedNames);
  let candidate = baseName;
  let suffix = 2;
  while (occupied.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function rustSourceArtifact(
  path: string,
  model: import("../../rust-ast/nodes.js").RustSourceFileModel,
): RustPlannedArtifact {
  return { kind: "source", path, model };
}

interface RustBinaryEntry {
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly functionName: string;
  readonly async: boolean;
  readonly fallible: boolean;
}

function resolveLibraryInitializationRoots(
  input: RustPlanningContext,
  exports: readonly RustSourcePackageFacadeExport[],
  packageInitializers: RustSourcePackageInitializerPlan,
  rootComponentId: string,
  diagnostics: TargetDiagnostic[],
): readonly SourceFile[] {
  const sourceFileByName = new Map(input.sourceFiles.map((sourceFile) =>
    [normalizeSourcePath(input.ast.getFileName(sourceFile)), sourceFile] as const));
  const roots = new Map<string, SourceFile>();
  for (const exported of exports) {
    const fileName = normalizeSourcePath(exported.sourceModuleFileName);
    const sourceFile = sourceFileByName.get(fileName);
    if (sourceFile === undefined) {
      diagnostics.push({
        code: "RUST_SOURCE_PACKAGE_INITIALIZATION_ROOT_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: `Public source-package module '${exported.sourceModuleFileName}' has no checked initialization root.`,
        evidence: ["target.capability=rust.backend.source-package-initialization"],
      });
      continue;
    }
    roots.set(fileName, sourceFile);
  }
  if (roots.size > 0 || diagnostics.length > 0) {
    return Object.freeze([...roots.entries()]
      .sort(([left], [right]) => compareRustArtifactNames(left, right))
      .map(([, sourceFile]) => sourceFile));
  }
  if (![...packageInitializers.byFileName.values()].some((initializer) =>
    initializer.componentId === rootComponentId)) {
    return Object.freeze([]);
  }
  const entrySourceFile = resolveProjectEntrySourceFile(input, diagnostics);
  return entrySourceFile === undefined ? [] : Object.freeze([entrySourceFile]);
}

function resolveProjectEntrySourceFile(
  input: RustPlanningContext,
  diagnostics: TargetDiagnostic[],
): SourceFile | undefined {
  const entryPoint = normalizeSourcePath(resolve(input.paths.projectRoot, input.project.entryPoint));
  const sourceFile = input.sourceFiles.find((candidate) =>
    normalizeSourcePath(resolve(input.ast.getFileName(candidate))) === entryPoint
  );
  if (sourceFile === undefined) {
    diagnostics.push({
      code: "RUST_MISSING_ENTRYPOINT",
      category: "error",
      source: "tsonic-rust",
      message: `Rust output requires entry point '${entryPoint}' to be part of the compiled sources.`,
      evidence: ["target.capability=rust.backend.entrypoint"],
    });
    return undefined;
  }
  return sourceFile;
}

function normalizeSourcePath(path: string): string {
  return path.split("\\").join("/");
}

function resolveBinaryEntry(
  input: RustPlanningContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  diagnostics: TargetDiagnostic[],
): RustBinaryEntry | undefined {
  const entryPoint = input.project.entryPoint;
  const entrySourceFile = resolveProjectEntrySourceFile(input, diagnostics);
  if (entrySourceFile === undefined) {
    return undefined;
  }
  const entryFileName = entrySourceFile === undefined ? undefined : input.ast.getFileName(entrySourceFile);
  const moduleName = entryFileName === undefined ? undefined : moduleNameByFileName.get(entryFileName);
  if (moduleName === undefined) {
    diagnostics.push({
      code: "RUST_MISSING_ENTRYPOINT",
      category: "error",
      source: "tsonic-rust",
      message: `Binary output requires entry point '${entryPoint}' to be part of the compiled sources.`,
      evidence: ["target.capability=rust.backend.entrypoint"],
    });
    return undefined;
  }
  for (const statement of input.ast.statements(entrySourceFile)) {
    if (statement === undefined || input.ast.kindName(statement) !== KindFunctionDeclaration) {
      continue;
    }
    const nameNode = Node_Name(input.ast, statement);
    if (nameNode === undefined || input.ast.text(nameNode) !== "main") {
      continue;
    }
    const asyncFact = input.facts.getFact(statement, rustAsyncFunctionFactKey);
    const returnCarrier = asyncFact?.outputCarrier ??
      input.facts.getFact(statement, rustSourceCallableReturnFactKey)?.returnCarrier;
    if (!input.ast.hasModifierKind(statement, "export") || !isRustUnitCarrier(returnCarrier)) {
      break;
    }
    return {
      sourceFile: entrySourceFile,
      moduleName,
      functionName: "main",
      async: asyncFact !== undefined,
      fallible: input.facts.getFact(statement, rustFallibleFactKey) !== undefined,
    };
  }
  diagnostics.push({
    code: "RUST_MISSING_ENTRYPOINT",
    category: "error",
    source: "tsonic-rust",
    message: "Binary output requires the entry module to export a 'main' function returning void.",
    evidence: ["target.capability=rust.backend.entrypoint"],
  });
  return undefined;
}

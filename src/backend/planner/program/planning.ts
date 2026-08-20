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
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import { rustTypeFromCarrier } from "../types/render.js";
import type {
  RustArtifactPlanResult,
  RustPlannedArtifact,
} from "../../artifacts/model.js";
import { planRustSourcePackageFacades } from "./source-package-facades.js";
import type { RustSourcePackageFacadeExport } from "./source-package-facades.js";
import {
  planRustSourcePackageInitializers,
  type RustSourcePackageInitializerPlan,
} from "./source-package-initializers.js";
import {
  planRustSourcePackageErrors,
  rustSourcePackageErrorTypeIdentity,
} from "./source-package-errors.js";
import { planRustSourcePackageComponents } from "./source-package-components.js";
import {
  materializeRustSourcePackageCrateArtifacts,
  planRustSourcePackageCargo,
  planRustSourcePackageCrateContent,
} from "./source-package-crates.js";

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
  const facadeResult = planRustSourcePackageFacades(input, identityPlan.identities);
  diagnostics.push(...facadeResult.diagnostics);
  if (facadeResult.plan === undefined || diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const facadePlan = facadeResult.plan;
  const componentResult = planRustSourcePackageComponents(
    input,
    identityPlan.identities,
    facadePlan,
  );
  if (componentResult.kind === "rejected") {
    return { artifacts: [], diagnostics: [...diagnostics, ...componentResult.diagnostics] };
  }
  const componentPlans = componentResult.components;
  const rootComponentPlan = componentPlans.find((component) => component.root);
  if (rootComponentPlan === undefined) {
    return {
      artifacts: [],
      diagnostics: [...diagnostics, {
        code: "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: "Rust artifact planning has no exact root source-package component.",
        evidence: ["target.capability=rust.backend.source-package-components"],
      }],
    };
  }
  const initializerResult = planRustSourcePackageInitializers(input, identityPlan.identities);
  diagnostics.push(...initializerResult.diagnostics);
  if (initializerResult.plan === undefined || diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const packageInitializers = initializerResult.plan;
  const sourcePackageErrorResult = planRustSourcePackageErrors(
    input,
    identityPlan.identities,
    componentPlans,
  );
  diagnostics.push(...sourcePackageErrorResult.diagnostics);
  if (sourcePackageErrorResult.plan === undefined || diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const sourcePackageErrors = sourcePackageErrorResult.plan;
  const structuralShapesModuleName = rootComponentPlan.structuralShapesModuleName;
  const componentPlanById = new Map(componentPlans.map((component) =>
    [component.componentId, component] as const));
  const externalStructuralShapeModuleByFileName = new Map(
    [...identityPlan.identities].flatMap(([fileName, identity]) => {
      if (identity.externalCrateName === undefined) {
        return [];
      }
      const component = componentPlanById.get(identity.componentId);
      return component === undefined
        ? []
        : [[fileName,
          `${identity.externalCrateName}::${component.structuralShapesModuleName}`] as const];
    }),
  );
  const programModuleName = rootComponentPlan.programModuleName;
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
  const reconstructedSources = reconstructRustSourceFiles(
    input,
    identityPlan.identities,
    facadePlan.externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    componentPlans,
    sourcePackageErrors,
    diagnostics,
  );
  if (reconstructedSources === undefined) {
    return { artifacts: [], diagnostics };
  }
  const externalItemPathByIdentity = reconstructedSources.externalItemPathByIdentity;
  const crateContentByComponentId = new Map(componentPlans.flatMap((component) => {
    const content = planRustSourcePackageCrateContent(
      input,
      identityPlan.identities,
      component,
      reconstructedSources.sourcesByComponentId.get(component.componentId) ?? [],
      facadePlan,
      packageInitializers,
      sourcePackageErrors,
      moduleNameByFileName,
      externalCrateNameByFileName,
      externalItemPathByIdentity,
      externalStructuralShapeModuleByFileName,
      diagnostics,
    );
    return content === undefined ? [] : [[component.componentId, content] as const];
  }));
  const rootCrateContent = crateContentByComponentId.get(rootComponentPlan.componentId);
  if (rootCrateContent === undefined || diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const rootPlannedSources = rootCrateContent.sources;

  // Activation: a runtime crate is a dependency only when planned code
  // references it (directly or through a declared alias). Surface-selected
  // crates without carrier/operation use stay out of the manifest.
  const cargoProject = planRustCargoProject(input.target, input.paths, input.runtimeReferences);
  if (cargoProject.project === undefined) {
    return { artifacts: [], diagnostics: [...diagnostics, ...cargoProject.diagnostics] };
  }
  if (cargoProject.project.kind === "user-owned" &&
    componentPlans.some((component) => !component.root)) {
    diagnostics.push({
      code: "RUST_USER_PROJECT_SOURCE_PACKAGE_CRATES_UNDECLARED",
      category: "error",
      source: "tsonic-rust",
      message:
        "User-owned Cargo mode requires the user project to declare generated source-package crates explicitly; the current target contract has no exact declaration for those paths.",
      evidence: [
        "target.capability=rust.backend.source-package-crates",
        `projectFile=${cargoProject.project.manifestPath}`,
      ],
    });
    return { artifacts: [], diagnostics };
  }
  const sourcePackageCargo = cargoProject.project.kind === "generated"
    ? planRustSourcePackageCargo(cargoProject.project.manifest, componentPlans, diagnostics)
    : undefined;
  if (cargoProject.project.kind === "generated" && sourcePackageCargo === undefined) {
    return { artifacts: [], diagnostics };
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
        rootPlannedSources,
        initializationRoots,
        packageInitializers,
        sourcePackageErrors,
        facadePlan.rootComponentId,
        diagnostics,
      );

  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }

  const sortedTopLevelModuleNames = [...new Set(
    [...identityPlan.identities.values()]
      .filter((identity) => identity.componentId === rootComponentPlan.componentId)
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
          ...rootCrateContent.libraryItems.flatMap((item) =>
            item.kind === "use"
              ? [item.alias ?? item.path.slice(item.path.lastIndexOf("::") + 2)]
          : []),
        ],
      );
  if (entryFunction !== undefined && binaryEntryExportName === undefined) {
    diagnostics.push({
      code: "RUST_BINARY_ENTRY_EXPORT_IDENTITY_MISSING",
      category: "error",
      source: "tsonic-rust",
      message: "The selected Rust binary entry has no exact root export identity.",
      evidence: ["target.capability=rust.backend.binary-entry"],
    });
    return { artifacts: [], diagnostics };
  }
  const activeCrates = new Set(input.runtimeReferences.flatMap((reference) => {
    const crate = reference.attributes?.[cargoCrateAttributeName];
    return typeof crate === "string" ? [crate] : [];
  }));
  const activeEpilogues = input.providerSemantics.binaryEpilogues.filter((epilogue) =>
    activeCrates.has(epilogue.requiredCrate));
  const epilogueErrorTypes = new Map<
    (typeof activeEpilogues)[number],
    import("../../rust-ast/nodes.js").RustType
  >();
  for (const epilogue of activeEpilogues) {
    if (epilogue.errorBoundary === "provider-native") {
      registerRustProviderErrorCarrier(input, epilogue.errorCarrier);
      const errorType = rustTypeFromCarrier(epilogue.errorCarrier);
      if (errorType === undefined) {
        diagnostics.push({
          code: "RUST_PROVIDER_EPILOGUE_ERROR_TYPE_MISSING",
          category: "error",
          source: "tsonic-rust",
          message: `Binary epilogue '${epilogue.path}' has no exact renderable provider error type.`,
          evidence: ["target.capability=rust.error.provider-conversion"],
        });
      } else {
        epilogueErrorTypes.set(epilogue, errorType);
      }
    }
  }
  const rootErrorDomain = sourcePackageErrors.domainsByComponentId.get(
    facadePlan.rootComponentId,
  );
  if (rootErrorDomain === undefined) {
    diagnostics.push({
      code: "RUST_SOURCE_PACKAGE_ERROR_DOMAIN_MISSING",
      category: "error",
      source: "tsonic-rust",
      message: "The root source-package component has no exact error-domain plan.",
      evidence: ["target.capability=rust.backend.source-package-errors"],
    });
    return { artifacts: [], diagnostics };
  }
  const rootErrorTypeIdentity = rustSourcePackageErrorTypeIdentity(
    facadePlan.rootComponentId,
    rootErrorDomain.errorDomain,
  );
  const programErrorModel = rootCrateContent.programErrorModel;
  const rootCrateErrorType: import("../../rust-ast/nodes.js").RustType = {
    kind: "named",
    path: programErrorModel === undefined
      ? "tsonic_rust_runtime::TsonicError"
      : `crate::${programModuleName}::TsonicError`,
    identity: rootErrorTypeIdentity,
  };
  const crateInitializer = planRustCrateInitializer(
    moduleInitializers ?? [],
    crateInitializerFunctionName,
    rootCrateErrorType,
  );
  const rootArtifacts = materializeRustSourcePackageCrateArtifacts(
    input,
    rootCrateContent,
    identityPlan.identities,
    facadePlan,
    diagnostics,
    {
      prefix: "",
      ...(sourcePackageCargo === undefined
        ? {}
        : { manifest: sourcePackageCargo.rootManifest }),
      additionalLibraryItems: [
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
    },
  );
  if (rootArtifacts === undefined || diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  const artifacts: RustPlannedArtifact[] = [...rootArtifacts];
  if (sourcePackageCargo !== undefined) {
    for (const component of componentPlans.filter((candidate) => !candidate.root)) {
      const content = crateContentByComponentId.get(component.componentId);
      const cargo = sourcePackageCargo.externalManifestsByComponentId.get(
        component.componentId,
      );
      if (content === undefined || cargo === undefined) {
        diagnostics.push({
          code: "RUST_SOURCE_PACKAGE_CRATE_ARTIFACT_MISSING",
          category: "error",
          source: "tsonic-rust",
          message: `Source-package component '${component.componentId}' has no exact generated crate artifact plan.`,
          evidence: ["target.capability=rust.backend.source-package-crates"],
        });
        continue;
      }
      const externalArtifacts = materializeRustSourcePackageCrateArtifacts(
        input,
        content,
        identityPlan.identities,
        facadePlan,
        diagnostics,
        { prefix: cargo.directory, manifest: cargo.manifest },
      );
      if (externalArtifacts !== undefined) {
        artifacts.push(...externalArtifacts);
      }
    }
  }
  if (diagnostics.length > 0) {
    return { artifacts: [], diagnostics };
  }
  if (outputType === "bin" && entryFunction !== undefined &&
    binaryEntryExportName !== undefined) {
    const crateName = readRustCrateName(input.target);
    const mainErrorType: import("../../rust-ast/nodes.js").RustType = {
      kind: "named",
      path: programErrorModel === undefined
        ? "tsonic_rust_runtime::TsonicError"
        : `${crateName}::${programModuleName}::TsonicError`,
      identity: rootErrorTypeIdentity,
    };
    const entryCall = {
      kind: "call" as const,
      path: `${crateName}::${binaryEntryExportName}`,
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
          expr: crateInitializer.errorType !== undefined
            ? {
              kind: "try" as const,
              resultErrorType: mainErrorType,
              operandErrorType: mainErrorType,
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
          mainErrorType,
          epilogue.errorBoundary === "provider-native"
            ? epilogueErrorTypes.get(epilogue)
            : undefined,
        ),
      };
    });
    const mainFallible = entryFunction.fallible ||
      crateInitializer?.errorType !== undefined ||
      activeEpilogues.some((epilogue) => epilogue.isFallible === true);
    const entryStatement = {
      kind: "expr" as const,
      expr: entryFunction.fallible
        ? {
            kind: "try" as const,
            expr: entryExecution,
            resultErrorType: mainErrorType,
            operandErrorType: mainErrorType,
          }
        : entryExecution,
    };
    const completionStatements = mainFallible
      ? [{
          kind: "tail" as const,
          expr: {
            kind: "call" as const,
            path: "Ok",
            typeArguments: [{ kind: "unit" as const }, mainErrorType],
            args: [{ kind: "path" as const, path: "()" }],
          },
        }]
      : [];
    const mainItem: RustItem = {
      kind: "function",
      name: "main",
      visibility: "private",
      params: [],
      ...(mainFallible
        ? {
            errorType: mainErrorType,
            body: { statements: [...initializationStatements, entryStatement, ...epilogueStatements, ...completionStatements] },
          }
        : { body: { statements: [...initializationStatements, entryStatement, ...epilogueStatements] } }),
    };
    artifacts.push(rustSourceArtifact("src/main.rs", createRustSourceFile([mainItem])));
  }
  return { artifacts, diagnostics: [] };
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

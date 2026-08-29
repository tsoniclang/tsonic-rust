import type { SourceFile } from "@tsonic/tsts";
import { resolve } from "node:path";
import {
  rejectedTargetStage,
  resolvedTargetStage,
} from "@tsonic/target-api/artifacts";
import type {
  TargetDiagnostic,
  TargetStageResult,
} from "@tsonic/target-api/artifacts";
import {
  KindFunctionDeclaration,
  Node_Name,
} from "@tsonic/target-api/source";
import { isRustUnitCarrier } from "../../../target-model/types/index.js";
import { createRustSourceFile, emptyRustGenerics } from "../../target-ast/nodes.js";
import type { RustItem } from "../../target-ast/nodes.js";
import { finalizeRustSourceStyle } from "../../target-ast/normalization/source-style.js";
import { planRustCargoProject } from "../project/cargo.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustSourceCallableReturnFactKey } from "../../../analysis/facts/keys.js";
import type { RustPlanningContext } from "../context.js";
import { reconstructRustSourceFiles } from "../artifacts/reconstruction.js";
import {
  planRustCrateInitializer,
  planRustModuleInitializers,
} from "./module-initialization.js";
import {
  allocateRustComponentSupportModuleName,
  planRustSourceOutputIdentities,
} from "../names/source-output-identities.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import { rustTypeFromCarrier } from "../types/render.js";
import type {
  RustPlannedArtifact,
  RustOutputPlan,
} from "../../artifact-model/output.js";
import { materializeRustSourcePackageFacades } from "./source-package-facades.js";
import type { RustSourcePackageFacadeExport } from "./source-package-facades.js";
import {
  planRustSourcePackageInitializers,
  type RustSourcePackageInitializerPlan,
} from "./source-package-initializers.js";
import {
  planRustSourcePackageErrors,
  rustRuntimeErrorTypeIdentity,
  rustSourcePackageErrorTypeIdentity,
} from "./source-package-errors.js";
import { planRustSourcePackageComponents } from "./source-package-components.js";
import {
  materializeRustSourcePackageCrateArtifacts,
  planRustSourcePackageCargo,
  planRustSourcePackageCrateContent,
} from "./source-package-crates.js";
import {
  planRustWorkerEntries,
  rustWorkerEntryIdentity,
  type RustWorkerEntryPlan,
} from "./worker-entries.js";

export function planRustOutput(input: RustPlanningContext): TargetStageResult<RustOutputPlan> {
  const diagnostics: TargetDiagnostic[] = [];
  const identityPlan = planRustSourceOutputIdentities({
    ast: input.program.source.ast,
    sourceFiles: input.program.sourceFiles,
    paths: input.host.paths,
    sourcePackages: input.host.sourcePackages,
  });
  if (identityPlan.kind === "rejected") {
    return rejectedTargetStage([...diagnostics, ...identityPlan.diagnostics]);
  }
  const moduleNameByFileName = new Map(
    [...identityPlan.identities].map(([fileName, identity]) => [fileName, identity.moduleName] as const),
  );
  const externalCrateNameByFileName = new Map(
    [...identityPlan.identities]
      .filter(([, identity]) => identity.externalCrateName !== undefined)
      .map(([fileName, identity]) => [fileName, identity.externalCrateName!] as const),
  );
  const facadeResult = materializeRustSourcePackageFacades(
    input,
    identityPlan.identities,
  );
  diagnostics.push(...facadeResult.diagnostics);
  if (facadeResult.plan === undefined || diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
  }
  const facadePlan = facadeResult.plan;
  const componentResult = planRustSourcePackageComponents(
    input,
    identityPlan.identities,
    facadePlan,
  );
  if (componentResult.kind === "rejected") {
    return rejectedTargetStage([...diagnostics, ...componentResult.diagnostics]);
  }
  const componentPlans = componentResult.components;
  const rootComponentPlan = componentPlans.find((component) => component.root);
  if (rootComponentPlan === undefined) {
    return rejectedTargetStage([...diagnostics, {
        code: "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: "Rust artifact planning has no exact root source-package component.",
        evidence: ["target.capability=rust.backend.source-package-components"],
      }]);
  }
  const initializerResult = planRustSourcePackageInitializers(input, identityPlan.identities);
  diagnostics.push(...initializerResult.diagnostics);
  if (initializerResult.plan === undefined || diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
  }
  const packageInitializers = initializerResult.plan;
  const sourcePackageErrorResult = planRustSourcePackageErrors(
    input,
    componentPlans,
  );
  diagnostics.push(...sourcePackageErrorResult.diagnostics);
  if (sourcePackageErrorResult.plan === undefined || diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
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
  const workerEntryIdentityByFileName = new Map<string, string>();
  for (const sourceFile of input.program.sourceModuleConstructions.targets()) {
    const fileName = input.program.source.ast.getFileName(sourceFile);
    const identity = identityPlan.identities.get(fileName);
    if (identity === undefined) {
      diagnostics.push({
        code: "RUST_WORKER_ENTRY_OUTPUT_IDENTITY_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: `Worker source module '${fileName}' has no exact generated output identity.`,
        sourceNode: sourceFile,
        evidence: ["target.capability=rust.backend.source-module-construction"],
      });
    } else {
      workerEntryIdentityByFileName.set(
        fileName,
        rustWorkerEntryIdentity(identity),
      );
    }
  }
  if (diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
  }
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
    return rejectedTargetStage(diagnostics);
  }
  const crateInitializerFunctionName = allocateRustComponentSupportModuleName(
    identityPlan.identities,
    facadePlan.rootComponentId,
    "initialize",
    [structuralShapesModuleName, programModuleName, initializerFacadeModuleName],
  );
  const activeEpilogues = input.program.binaryEpilogues;
  const epilogueErrorTypes = new Map<
    (typeof activeEpilogues)[number],
    import("../../target-ast/nodes.js").RustType
  >();
  for (const epilogue of activeEpilogues) {
    if (epilogue.errorBoundary === "provider-native") {
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
  if (diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
  }
  const reconstructedSources = reconstructRustSourceFiles(
    input,
    identityPlan.identities,
    facadePlan.externalItemPathByIdentity,
    externalStructuralShapeModuleByFileName,
    workerEntryIdentityByFileName,
    componentPlans,
    sourcePackageErrors,
    diagnostics,
  );
  if (reconstructedSources === undefined) {
    return rejectedTargetStage(diagnostics);
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
    return rejectedTargetStage(diagnostics);
  }
  const rootPlannedSources = rootCrateContent.sources;

  // Activation: a runtime crate is a dependency only when planned code
  // references it (directly or through a declared alias). Surface-selected
  // crates without carrier/operation use stay out of the manifest.
  const cargoProject = planRustCargoProject(
    input.program.configuration,
    input.program.runtimeReferences,
  );
  const sourcePackageCargo = cargoProject.kind === "generated"
    ? planRustSourcePackageCargo(cargoProject.manifest, componentPlans, diagnostics)
    : undefined;
  if (cargoProject.kind === "generated" && sourcePackageCargo === undefined) {
    return rejectedTargetStage(diagnostics);
  }

  const outputType = input.program.configuration.outputType;
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
    return rejectedTargetStage(diagnostics);
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
    return rejectedTargetStage(diagnostics);
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
    return rejectedTargetStage(diagnostics);
  }
  const rootErrorTypeIdentity = rustSourcePackageErrorTypeIdentity(
    facadePlan.rootComponentId,
    rootErrorDomain.errorDomain,
  );
  const programErrorModel = rootCrateContent.programErrorModel;
  const rootCrateErrorType: import("../../target-ast/nodes.js").RustType = {
    kind: "named",
    path: programErrorModel === undefined
      ? "tsonic_rust_runtime::TsonicError"
      : `crate::${programModuleName}::TsonicError`,
    identity: rootErrorTypeIdentity,
  };
  const workerEntries = planRustWorkerEntries({
    planning: input,
    identities: identityPlan.identities,
    components: componentPlans,
    contentByComponentId: crateContentByComponentId,
    packageInitializers,
    sourcePackageErrors,
    rootComponentId: facadePlan.rootComponentId,
    rootCrateName: input.program.configuration.crateName,
    rootErrorType: rootCrateErrorType,
    diagnostics,
  });
  if (workerEntries === undefined || diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
  }
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
        ...(workerEntries.itemsByComponentId.get(rootComponentPlan.componentId) ?? []),
      ],
    },
  );
  if (rootArtifacts === undefined || diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
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
        {
          prefix: cargo.directory,
          manifest: cargo.manifest,
          additionalLibraryItems:
            workerEntries.itemsByComponentId.get(component.componentId) ?? [],
        },
      );
      if (externalArtifacts !== undefined) {
        artifacts.push(...externalArtifacts);
      }
    }
  }
  if (diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
  }
  if (outputType === "bin" && entryFunction !== undefined &&
    binaryEntryExportName !== undefined) {
    const crateName = input.program.configuration.crateName;
    const mainErrorType: import("../../target-ast/nodes.js").RustType = {
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
    const workerDispatchStatements = planRustWorkerDispatch(
      input,
      workerEntries.entries,
      mainErrorType,
      epilogueStatements,
      diagnostics,
    );
    if (workerDispatchStatements === undefined || diagnostics.length > 0) {
      return rejectedTargetStage(diagnostics);
    }
    const mainFallible = entryFunction.fallible ||
      crateInitializer?.errorType !== undefined ||
      workerEntries.entries.length > 0 ||
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
            genericArguments: [
              { kind: "type" as const, type: { kind: "unit" as const } },
              { kind: "type" as const, type: mainErrorType },
            ],
            args: [{ kind: "path" as const, path: "()" }],
          },
        }]
      : [];
    const mainItem: RustItem = {
      kind: "function",
      name: "main",
      visibility: "private",
      generics: emptyRustGenerics,
      params: [],
      ...(mainFallible
        ? {
            errorType: mainErrorType,
            body: { statements: [...workerDispatchStatements, ...initializationStatements, entryStatement, ...epilogueStatements, ...completionStatements] },
          }
        : { body: { statements: [...workerDispatchStatements, ...initializationStatements, entryStatement, ...epilogueStatements] } }),
    };
    artifacts.push(rustSourceArtifact("src/main.rs", createRustSourceFile([mainItem])));
  }
  return resolvedTargetStage(Object.freeze({
    artifacts: Object.freeze(artifacts.map(finalizeRustPlannedArtifact)),
  }));
}

function finalizeRustPlannedArtifact(artifact: RustPlannedArtifact): RustPlannedArtifact {
  return artifact.kind === "project"
    ? Object.freeze(artifact)
    : Object.freeze({
        ...artifact,
        model: finalizeRustSourceStyle(artifact.model),
      });
}

function planRustWorkerDispatch(
  input: RustPlanningContext,
  entries: readonly RustWorkerEntryPlan[],
  mainErrorType: import("../../target-ast/nodes.js").RustType,
  epilogueStatements: readonly import("../../target-ast/nodes.js").RustStmt[],
  diagnostics: TargetDiagnostic[],
): readonly import("../../target-ast/nodes.js").RustStmt[] | undefined {
  if (entries.length === 0) return Object.freeze([]);
  const entryBySourceFile = new Map(entries.map((entry) =>
    [entry.sourceFile, entry] as const));
  const constructionsByBootstrapId = new Map<string, Set<RustWorkerEntryPlan>>();
  for (const construction of input.program.sourceModuleConstructions.entries()) {
    const entry = entryBySourceFile.get(construction.targetSourceFile);
    if (entry === undefined) {
      diagnostics.push({
        code: "RUST_WORKER_ENTRY_DISPATCH_IDENTITY_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: "A selected source-module construction has no exact worker dispatch entry.",
        sourceNode: construction.expression,
        evidence: ["target.capability=rust.backend.source-module-construction"],
      });
      continue;
    }
    const selected = constructionsByBootstrapId.get(construction.bootstrap.id) ??
      new Set<RustWorkerEntryPlan>();
    selected.add(entry);
    constructionsByBootstrapId.set(construction.bootstrap.id, selected);
  }
  if (diagnostics.length > 0) return undefined;

  const statements: import("../../target-ast/nodes.js").RustStmt[] = [];
  const bootstraps = [...input.program.sourceModuleConstructions.bootstraps()]
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  for (const [bootstrapIndex, bootstrap] of bootstraps.entries()) {
    const selectedEntries = [...(constructionsByBootstrapId.get(bootstrap.id) ?? [])]
      .sort((left, right) => left.identity.localeCompare(right.identity, "en"));
    if (selectedEntries.length === 0) continue;
    const providerErrorType = bootstrap.errorBoundary === "provider-native"
      ? bootstrap.errorCarrier === undefined
        ? undefined
        : rustTypeFromCarrier(bootstrap.errorCarrier)
      : undefined;
    if (bootstrap.errorBoundary === "provider-native" && providerErrorType === undefined) {
      diagnostics.push({
        code: "RUST_WORKER_BOOTSTRAP_ERROR_TYPE_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: `Source-module bootstrap '${bootstrap.id}' has no exact renderable provider error type.`,
        evidence: ["target.capability=rust.backend.source-module-construction"],
      });
      continue;
    }
    const entryName = `worker_entry_selection_${bootstrapIndex + 1}`;
    const bootstrapCall = applyRustErrorBoundary(
      { kind: "call", path: bootstrap.path, args: [] },
      bootstrap.errorBoundary,
      mainErrorType,
      providerErrorType,
    );
    const unsupportedWorkerEntryError = {
      kind: "call" as const,
      path: "tsonic_rust_runtime::TsonicError::unsupported",
      args: [{
        kind: "str-literal" as const,
        value: "Worker process selected an entry absent from the closed generated dispatch table.",
      }],
    };
    const workerEntryError = mainErrorType.kind === "named" &&
      mainErrorType.identity === rustRuntimeErrorTypeIdentity
      ? unsupportedWorkerEntryError
      : {
          kind: "method-call" as const,
          receiver: unsupportedWorkerEntryError,
          method: "into",
          args: [],
        };
    statements.push({
      kind: "let",
      name: entryName,
      mutable: false,
      init: bootstrapCall,
    }, {
      kind: "if-let-some",
      binding: entryName,
      expression: { kind: "path", path: entryName },
      body: {
        statements: [
          ...selectedEntries.map((entry): import("../../target-ast/nodes.js").RustStmt => {
            const call = {
              kind: "call" as const,
              path: entry.callPath,
              args: [],
            };
            const execution = entry.asynchronous
              ? {
                  kind: "call" as const,
                  path: "tsonic_rust_runtime::block_on",
                  args: [call],
                }
              : call;
            const invoke = entry.operandErrorType === undefined
              ? execution
              : {
                  kind: "try" as const,
                  expr: execution,
                  resultErrorType: mainErrorType,
                  operandErrorType: entry.operandErrorType,
                };
            return {
              kind: "if",
              condition: {
                kind: "binary",
                operator: "==",
                left: { kind: "path", path: entryName },
                right: { kind: "str-literal", value: entry.identity },
              },
              then: {
                statements: [
                  { kind: "expr", expr: invoke },
                  ...epilogueStatements,
                  okReturn(mainErrorType),
                ],
              },
            };
          }),
          {
            kind: "return",
            expr: {
              kind: "call",
              path: "Err",
              args: [workerEntryError],
            },
          },
        ],
      },
    });
  }
  return diagnostics.length === 0 ? Object.freeze(statements) : undefined;
}

function okReturn(
  errorType: import("../../target-ast/nodes.js").RustType,
): import("../../target-ast/nodes.js").RustStmt {
  return {
    kind: "return",
    expr: {
      kind: "call",
      path: "Ok",
      genericArguments: [
        { kind: "type", type: { kind: "unit" } },
        { kind: "type", type: errorType },
      ],
      args: [{ kind: "path", path: "()" }],
    },
  };
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
  model: import("../../target-ast/nodes.js").RustSourceFileModel,
): RustPlannedArtifact {
  return Object.freeze({ kind: "source", path, model });
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
  const sourceFileByName = new Map(input.program.sourceFiles.map((sourceFile) =>
    [normalizeSourcePath(input.program.source.ast.getFileName(sourceFile)), sourceFile] as const));
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
  const entryPoint = normalizeSourcePath(resolve(input.host.paths.projectRoot, input.host.entryPoint));
  const sourceFile = input.program.sourceFiles.find((candidate) =>
    normalizeSourcePath(resolve(input.program.source.ast.getFileName(candidate))) === entryPoint
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
  const entryPoint = input.host.entryPoint;
  const entrySourceFile = resolveProjectEntrySourceFile(input, diagnostics);
  if (entrySourceFile === undefined) {
    return undefined;
  }
  const entryFileName = entrySourceFile === undefined ? undefined : input.program.source.ast.getFileName(entrySourceFile);
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
  for (const statement of input.program.source.ast.statements(entrySourceFile)) {
    if (statement === undefined || input.program.source.ast.kindName(statement) !== KindFunctionDeclaration) {
      continue;
    }
    const nameNode = Node_Name(input.program.source.ast, statement);
    if (nameNode === undefined || input.program.source.ast.text(nameNode) !== "main") {
      continue;
    }
    const asyncFact = input.program.facts.getFact(statement, rustAsyncFunctionFactKey);
    const returnCarrier = asyncFact?.outputCarrier ??
      input.program.facts.getFact(statement, rustSourceCallableReturnFactKey)?.returnCarrier;
    if (!input.program.source.ast.hasModifierKind(statement, "export") || !isRustUnitCarrier(returnCarrier)) {
      break;
    }
    return {
      sourceFile: entrySourceFile,
      moduleName,
      functionName: "main",
      async: asyncFact !== undefined,
      fallible: input.program.facts.getFact(statement, rustFallibleFactKey) !== undefined,
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

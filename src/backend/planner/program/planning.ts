import {
  failTargetPlannerInvariant,
  rejectedTargetStage,
  resolvedTargetStage,
} from "@tsonic/target-api/artifacts";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustItem } from "../../target-ast/syntax/nodes.js";
import { rustItemBindingNames } from "../../target-ast/syntax/item-bindings.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import { finalizeRustSourceStyle } from "../../target-ast/normalization/source-style.js";
import { finalizeRustDeadCode } from "../../target-ast/normalization/dead-code.js";
import { planRustCargoProject } from "../project/cargo.js";
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
import { rustErrorBoundaryOperandType, rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import { planRustBinaryErrors, type RustBinaryErrorPlan } from "./binary-errors.js";
import { rustTypeFromCarrier } from "../types/render.js";
import { planRustBinaryHookCallPlan } from "./binary-hook-contexts.js";
import type { RustBinaryHookCallPlan } from "./binary-hook-contexts.js";
import type {
  RustPlannedArtifact,
  RustOutputPlan,
} from "../../artifact-model/output.js";
import { materializeRustSourcePackageFacades } from "./source-package-facades.js";
import {
  planRustSourcePackageInitializers,
} from "./source-package-initializers.js";
import {
  planRustSourcePackageErrors,
} from "./source-package-errors.js";
import { createRustSourcePackageTypeRenderingContext, planRustSourcePackageComponents } from "./source-package-components.js";
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
import { createRustCrateRootSourceFile } from "../project/foundation.js";
import { verifyRustFoundationPlan } from "../foundation/verify.js";
import { applyRustFoundationImports } from "../foundation/imports.js";
import { planRustAsyncExecution } from "./async-execution.js";
import { planRustOwnedBinaryEntry, rustBinaryExitCodeType } from "./owned-entry.js";

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
  const crateInitializerFunctionBase = allocateRustComponentSupportModuleName(
    identityPlan.identities,
    facadePlan.rootComponentId,
    "initialize",
    [structuralShapesModuleName, programModuleName, initializerFacadeModuleName],
  );
  const activeHooks = input.program.binaryHooks;
  const binaryExecution = input.program.binaryExecution;
  const hookErrorTypes = new Map<
    (typeof activeHooks)[number],
    import("../../target-ast/syntax/nodes.js").RustType
  >();
  for (const epilogue of activeHooks) {
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
        hookErrorTypes.set(epilogue, errorType);
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
  const typeRenderingContextFor = (component: (typeof componentPlans)[number]) =>
    createRustSourcePackageTypeRenderingContext(input, component, sourcePackageErrors, {
      moduleNameByFileName, externalCrateNameByFileName, externalItemPathByIdentity, externalStructuralShapeModuleByFileName,
    });
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
    ? planRustSourcePackageCargo(cargoProject.manifest, componentPlans, diagnostics,
      input.program.configuration.outputType === "bin" ? input.program.binaryDispatchDemand.linkedComponentIds : [])
    : undefined;
  if (cargoProject.kind === "generated" && sourcePackageCargo === undefined) {
    return rejectedTargetStage(diagnostics);
  }

  const outputType = input.program.configuration.outputType;
  const initialization = input.program.errorRegions.initialization;
  const entrySourceFile = initialization.entrySourceFile;
  const moduleInitializers = initialization.root.modules.length === 0
    ? []
    : planRustModuleInitializers(
        rootPlannedSources,
        initialization.root,
        packageInitializers,
        typeRenderingContextFor(rootComponentPlan),
      );

  if (diagnostics.length > 0) {
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
  const rootErrorTypeIdentity = rootErrorDomain.errorTypeIdentity;
  const rootCrateErrorType: import("../../target-ast/syntax/nodes.js").RustType = {
    kind: "named",
    path: rootErrorDomain.errorDomain === "runtime"
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
    typeRenderingContextFor,
    diagnostics,
  });
  if (workerEntries === undefined || diagnostics.length > 0) {
    return rejectedTargetStage(diagnostics);
  }
  const rootBindings = new Set([...rootCrateContent.libraryItems,
    ...(workerEntries.itemsByComponentId.get(rootComponentPlan.componentId) ?? [])].flatMap(rustItemBindingNames));
  const crateInitializerFunctionName = allocateRustGeneratedName(rootBindings, crateInitializerFunctionBase);
  const crateInitializer = planRustCrateInitializer(
    initialization.root,
    moduleInitializers,
    crateInitializerFunctionName,
    typeRenderingContextFor(rootComponentPlan),
    rootBindings,
  );
  if (initialization.root.modules.length > 0 && crateInitializer === undefined) {
    failTargetPlannerInvariant("tsonic-rust",
      "The completed root initializer error composition has no exact native reconstruction.",
      entrySourceFile);
  }
  const lifecycleErrorType: import("../../target-ast/syntax/nodes.js").RustType = {
    kind: "named",
    path: rootErrorDomain.errorDomain === "runtime"
      ? "tsonic_rust_runtime::TsonicError" : `${input.program.configuration.crateName}::${programModuleName}::TsonicError`,
    identity: rootErrorTypeIdentity,
  };
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
        ...(crateInitializer?.items ?? []),
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
  if (outputType === "bin" && entrySourceFile !== undefined) {
    const crateName = input.program.configuration.crateName;
    const initializerError = initialization.root.error.kind !== "native" ? undefined : {
      identity: "initialization", errorType: {
        ...crateInitializer!.errorType!, path: `${crateName}::${crateInitializer!.errorName}`,
      },
    };
    const workerBySource = new Map(workerEntries.entries.map(entry => [entry.sourceFile, entry]));
    const errors = planRustBinaryErrors(initialization.binary, lifecycleErrorType, [
      ...(initializerError === undefined ? [] : [initializerError]),
      ...initialization.binary.sources.filter(source => source.kind === "worker").map(source => {
        const entry = workerBySource.get(source.sourceFile)!;
        return { identity: source.identity, errorType: entry.operandErrorType! };
      }),
    ]);
    const mainErrorType = errors.errorType;
    const executor = binaryExecution.kind === "native" ? binaryExecution.executor : undefined;
    const hookCalls = new Map<(typeof activeHooks)[number], RustBinaryHookCallPlan>();
    for (const hook of activeHooks) {
      const plan = planRustBinaryHookCallPlan(hook, input, componentPlans, sourcePackageErrors, diagnostics);
      if (plan === undefined) return rejectedTargetStage(diagnostics);
      hookCalls.set(hook, plan);
    }
    const executeAsync = (future: import("../../target-ast/syntax/nodes.js").RustExpr): import("../../target-ast/syntax/nodes.js").RustExpr =>
      binaryExecution.kind === "owned" ? { kind: "await", expr: future }
      : planRustAsyncExecution(executor === undefined
        ? { kind: "call", path: "tsonic_rust_runtime::block_on", args: [future] }
        : hookCalls.get(executor)!.call([future]), executor, (execution, selected) => errors.lifecycle(execution,
          rustErrorBoundaryOperandType(selected.errorBoundary, lifecycleErrorType, hookErrorTypes.get(selected))));
    const completionType: import("../../target-ast/syntax/nodes.js").RustType = { kind: "unit" };
    const successfulCompletion: import("../../target-ast/syntax/nodes.js").RustExpr = {
      kind: "path", path: "()",
    };
    const propagateInitialization = (expression: import("../../target-ast/syntax/nodes.js").RustExpr) =>
      initializerError === undefined ? errors.lifecycle(expression, lifecycleErrorType)
        : errors.propagate(initializerError, expression);
    const initializationStatements = crateInitializer === undefined
      ? []
      : [{
          kind: "expr" as const,
          expr: crateInitializer.errorType !== undefined
            ? propagateInitialization(crateInitializer.asynchronous
                  ? executeAsync({
                        kind: "call" as const,
                        path: `${crateName}::${crateInitializer.functionName}`,
                        args: [],
                      })
                  : {
                      kind: "call" as const,
                      path: `${crateName}::${crateInitializer.functionName}`,
                      args: [],
                    })
            : crateInitializer.asynchronous
              ? executeAsync({
                    kind: "call" as const,
                    path: `${crateName}::${crateInitializer.functionName}`,
                    args: [],
                  })
              : {
                  kind: "call" as const,
                  path: `${crateName}::${crateInitializer.functionName}`,
                  args: [],
                },
        }];
    const planHook = (epilogue: (typeof activeHooks)[number]) => {
      const call = hookCalls.get(epilogue)!.call([]);
      if (epilogue.isFallible !== true) {
        return { kind: "expr" as const, expr: call };
      }
      return {
        kind: "expr" as const,
        expr: errors.lifecycle(call, rustErrorBoundaryOperandType(
          epilogue.errorBoundary, lifecycleErrorType,
          epilogue.errorBoundary === "provider-native"
            ? hookErrorTypes.get(epilogue)
            : undefined,
        )),
      };
    };
    const startupStatements = activeHooks.filter(hook => hook.phase === "before-initialization").map(planHook);
    const epilogueStatements = activeHooks.filter(hook => hook.phase === "after-entry").map(planHook);
    const workerDispatchStatements = planRustWorkerDispatch(
      input,
      workerEntries.entries,
      errors,
      lifecycleErrorType,
      completionType,
      successfulCompletion,
      binaryExecution.kind === "owned" ? [] : epilogueStatements,
      executeAsync,
      diagnostics,
    );
    if (workerDispatchStatements === undefined || diagnostics.length > 0) {
      return rejectedTargetStage(diagnostics);
    }
    const mainFallible = crateInitializer?.errorType !== undefined ||
      workerEntries.entries.length > 0 ||
      activeHooks.some((epilogue) => epilogue.isFallible === true);
    const completionStatements = mainFallible
      ? [{
          kind: "tail" as const,
          expr: {
            kind: "call" as const,
            path: "Ok",
            genericArguments: [
              { kind: "type" as const, type: completionType },
              { kind: "type" as const, type: mainErrorType },
            ],
            args: [successfulCompletion],
          },
        }]
      : [];
    const mainBody = binaryExecution.kind === "owned" ? planRustOwnedBinaryEntry({ execution: binaryExecution,
      hook: hookCalls.get(binaryExecution.owner)!, errors, fallible: mainFallible,
      ownerErrorType: binaryExecution.owner.isFallible ? rustErrorBoundaryOperandType(
        binaryExecution.owner.errorBoundary, lifecycleErrorType, hookErrorTypes.get(binaryExecution.owner)) : lifecycleErrorType,
      afterEntry: epilogueStatements,
      body: { statements: [...startupStatements, ...workerDispatchStatements, ...initializationStatements, ...completionStatements] } })
      : { statements: [...startupStatements, ...workerDispatchStatements, ...initializationStatements, ...epilogueStatements, ...completionStatements] };
    const mainItem: RustItem = {
      kind: "function",
      name: "main",
      visibility: "private",
      generics: emptyRustGenerics,
      params: [],
      ...(binaryExecution.kind === "owned" ? { returnType: rustBinaryExitCodeType } : {}),
      ...(mainFallible ? { errorType: mainErrorType } : {}),
      body: mainBody,
    };
    artifacts.push(rustSourceArtifact(
      "src/main.rs",
      createRustCrateRootSourceFile(input.program.configuration.foundation, [...errors.items, mainItem]),
    ));
  }
  const finalizedArtifacts = Object.freeze(artifacts.map((artifact) =>
    finalizeRustPlannedArtifact(
      artifact,
      input.program.configuration.foundation,
    )));
  const foundationDiagnostics = verifyRustFoundationPlan(
    input.program,
    finalizedArtifacts,
  );
  return foundationDiagnostics.length > 0
    ? rejectedTargetStage(foundationDiagnostics)
    : resolvedTargetStage(Object.freeze({
        edition: input.program.configuration.edition,
        artifacts: finalizedArtifacts,
      }));
}

function finalizeRustPlannedArtifact(
  artifact: RustPlannedArtifact,
  foundation: import("../../../target-model/foundation/model.js").RustFoundation,
): RustPlannedArtifact {
  return artifact.kind === "project"
    ? Object.freeze(artifact)
    : Object.freeze({
        ...artifact,
        model: finalizeRustDeadCode(
          finalizeRustSourceStyle(
            applyRustFoundationImports(artifact.model, foundation),
          ),
        ),
      });
}

function planRustWorkerDispatch(
  input: RustPlanningContext,
  entries: readonly RustWorkerEntryPlan[],
  errors: RustBinaryErrorPlan,
  lifecycleErrorType: import("../../target-ast/syntax/nodes.js").RustType,
  completionType: import("../../target-ast/syntax/nodes.js").RustType,
  successfulCompletion: import("../../target-ast/syntax/nodes.js").RustExpr,
  epilogueStatements: readonly import("../../target-ast/syntax/nodes.js").RustStmt[],
  executeAsync: (future: import("../../target-ast/syntax/nodes.js").RustExpr) => import("../../target-ast/syntax/nodes.js").RustExpr,
  diagnostics: TargetDiagnostic[],
): readonly import("../../target-ast/syntax/nodes.js").RustStmt[] | undefined {
  if (entries.length === 0) return Object.freeze([]);
  const mainErrorType = errors.errorType;
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

  const statements: import("../../target-ast/syntax/nodes.js").RustStmt[] = [];
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
    const bootstrapCall = errors.lifecycle(
      { kind: "call", path: bootstrap.path, args: [] },
      rustErrorBoundaryOperandType(bootstrap.errorBoundary, lifecycleErrorType, providerErrorType),
    );
    const unsupportedWorkerEntryError = {
      kind: "call" as const,
      path: "tsonic_rust_runtime::TsonicError::unsupported",
      args: [{
        kind: "str-literal" as const,
        value: "Worker process selected an entry absent from the closed generated dispatch table.",
      }],
    };
    const workerEntryError = errors.lifecycleError(unsupportedWorkerEntryError, rustTargetRuntimeErrorType);
    statements.push({
      kind: "let",
      name: entryName,
      mutable: false,
      init: bootstrapCall,
    }, { kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: entryName }] }, expression: { kind: "path", path: entryName }, whenTrue: { kind: "block", body: {
        statements: [
          ...selectedEntries.map((entry): import("../../target-ast/syntax/nodes.js").RustStmt => {
            const call = {
              kind: "call" as const,
              path: entry.callPath,
              args: [],
            };
            const execution = entry.asynchronous
              ? executeAsync(call)
              : call;
            const invoke = entry.operandErrorType === undefined
              ? execution
              : entry.nativeError ? errors.propagate({ identity: entry.errorIdentity, errorType: entry.operandErrorType }, execution)
                : errors.lifecycle(execution, entry.operandErrorType);
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
                  okReturn(mainErrorType, completionType, successfulCompletion),
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
      } } } });
  }
  return diagnostics.length === 0 ? Object.freeze(statements) : undefined;
}

function okReturn(
  errorType: import("../../target-ast/syntax/nodes.js").RustType,
  completionType: import("../../target-ast/syntax/nodes.js").RustType,
  successfulCompletion: import("../../target-ast/syntax/nodes.js").RustExpr,
): import("../../target-ast/syntax/nodes.js").RustStmt {
  return {
    kind: "return",
    expr: {
      kind: "call",
      path: "Ok",
      genericArguments: [
        { kind: "type", type: completionType },
        { kind: "type", type: errorType },
      ],
      args: [successfulCompletion],
    },
  };
}

function rustSourceArtifact(
  path: string,
  model: import("../../target-ast/syntax/nodes.js").RustSourceFileModel,
): RustPlannedArtifact {
  return Object.freeze({ kind: "source", path, model });
}

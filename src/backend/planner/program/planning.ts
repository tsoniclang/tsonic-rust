import { failRustPlannerInvariant } from "../diagnostics.js";
import {
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
import { planRustCargoProject } from "../project/project-artifacts.js";
import type { RustPlanningContext } from "../context.js";
import { planRustSourceFiles } from "../artifacts/source-files.js";
import {
  planRustCrateInitializer,
  planRustModuleInitializers,
} from "./module-initialization.js";
import { planRustBinaryErrors, type RustBinaryErrorPlan } from "./binary-errors.js";
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
  type RustWorkerEntryPlan,
} from "./worker-entries.js";
import { createRustCrateRootSourceFile } from "../project/foundation.js";
import { applyRustFoundationImports } from "../../target-ast/normalization/foundation-imports.js";
import { planRustAsyncExecution } from "./async-execution.js";
import { planRustOwnedBinaryEntry, rustBinaryExitCodeType } from "./owned-entry.js";

export function planRustOutput(input: RustPlanningContext): TargetStageResult<RustOutputPlan> {
  const diagnostics: TargetDiagnostic[] = [];
  const emission = input.program.records.programEmission.get();
  if (emission === undefined) failRustPlannerInvariant("An admitted program requires its complete sealed native output contract.");
  const identities = emission.identities;
  const moduleNameByFileName = new Map(
    [...identities].map(([fileName, identity]) => [fileName, identity.moduleName] as const),
  );
  const externalCrateNameByFileName = new Map(
    [...identities]
      .filter(([, identity]) => identity.externalCrateName !== undefined)
      .map(([fileName, identity]) => [fileName, identity.externalCrateName!] as const),
  );
  const facadePlan = materializeRustSourcePackageFacades(input);
  const componentPlans = planRustSourcePackageComponents(input);
  const rootComponentPlan = componentPlans.find((component) => component.root);
  if (rootComponentPlan === undefined) {
    failRustPlannerInvariant("An admitted program requires its root native source component.");
  }
  const packageInitializers = planRustSourcePackageInitializers(input);
  const sourcePackageErrors = planRustSourcePackageErrors(input);
  const componentPlanById = new Map(componentPlans.map((component) =>
    [component.componentId, component] as const));
  const externalStructuralShapeModuleByFileName = new Map(
    [...identities].flatMap(([fileName, identity]) => {
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
  const workerEntryEmission = input.program.records.workerEntries.get();
  if (workerEntryEmission === undefined) failRustPlannerInvariant("An admitted program requires its closed worker entry inventory.");
  const workerEntryIdentityByFileName = new Map(workerEntryEmission.map(entry => [entry.fileName, entry.identity]));
  const programModuleName = rootComponentPlan.programModuleName;
  const initializerFacadeModuleName = packageInitializers.facadeModuleNameByComponent.get(
    facadePlan.rootComponentId,
  );
  if (initializerFacadeModuleName === undefined) {
    failRustPlannerInvariant("An admitted root source component requires its initializer facade identity.");
  }
  const crateInitializerFunctionBase = emission.initializerFunctionBase;
  const activeHooks = emission.hooks;
  const binaryExecution = emission.execution;
  const reconstructedSources = planRustSourceFiles(
    input,
    identities,
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
      identities,
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

  // Activation: a runtime crate is a dependency only when planned code
  // references it (directly or through a declared alias). Surface-selected
  // crates without carrier/operation use stay out of the manifest.
  const cargoProject = planRustCargoProject(input);
  const sourcePackageCargo = cargoProject.kind === "generated"
    ? planRustSourcePackageCargo(input)
    : undefined;
  if (cargoProject.kind === "generated" && sourcePackageCargo === undefined) {
    return rejectedTargetStage(diagnostics);
  }

  const outputType = emission.configuration.outputType;
  const initialization = emission.initialization;
  const entrySourceFile = initialization.entrySourceFile;
  const moduleInitializers = initialization.root.modules.length === 0
    ? []
    : planRustModuleInitializers(
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
    failRustPlannerInvariant("An admitted root source component requires its exact physical error domain.", entrySourceFile);
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
    components: componentPlans,
    contentByComponentId: crateContentByComponentId,
    packageInitializers,
    sourcePackageErrors,
    rootComponentId: facadePlan.rootComponentId,
    rootCrateName: emission.configuration.crateName,
    rootErrorType: rootCrateErrorType,
    typeRenderingContextFor,
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
    failRustPlannerInvariant(
      "The completed root initializer error composition has no exact native reconstruction.",
      entrySourceFile);
  }
  const lifecycleErrorType: import("../../target-ast/syntax/nodes.js").RustType = {
    kind: "named",
    path: rootErrorDomain.errorDomain === "runtime"
      ? "tsonic_rust_runtime::TsonicError" : `${emission.configuration.crateName}::${programModuleName}::TsonicError`,
    identity: rootErrorTypeIdentity,
  };
  const rootArtifacts = materializeRustSourcePackageCrateArtifacts(
    input,
    rootCrateContent,
    identities,
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
        failRustPlannerInvariant("An admitted source component requires its generated crate artifact plan.");
      }
      const externalArtifacts = materializeRustSourcePackageCrateArtifacts(
        input,
        content,
        identities,
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
    const crateName = emission.configuration.crateName;
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
      const plan = planRustBinaryHookCallPlan(hook, input);
      if (plan === undefined) return rejectedTargetStage(diagnostics);
      hookCalls.set(hook, plan);
    }
    const executeAsync = (future: import("../../target-ast/syntax/nodes.js").RustExpr): import("../../target-ast/syntax/nodes.js").RustExpr =>
      binaryExecution.kind === "owned" ? { kind: "await", expr: future }
      : planRustAsyncExecution(executor === undefined
        ? { kind: "call", path: "tsonic_rust_runtime::block_on", args: [future] }
        : hookCalls.get(executor)!.call([future]), executor, execution => errors.lifecycle(execution));
    const completionType: import("../../target-ast/syntax/nodes.js").RustType = { kind: "unit" };
    const successfulCompletion: import("../../target-ast/syntax/nodes.js").RustExpr = {
      kind: "path", path: "()",
    };
    const propagateInitialization = (expression: import("../../target-ast/syntax/nodes.js").RustExpr) =>
      initializerError === undefined ? errors.lifecycle(expression)
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
        expr: errors.lifecycle(call),
      };
    };
    const startupStatements = activeHooks.filter(hook => hook.phase === "before-initialization").map(planHook);
    const epilogueStatements = activeHooks.filter(hook => hook.phase === "after-entry").map(planHook);
    const workerDispatchStatements = planRustWorkerDispatch(
      input,
      workerEntries.entries,
      errors,
      completionType,
      successfulCompletion,
      binaryExecution.kind === "owned" ? [] : epilogueStatements,
      executeAsync,
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
      createRustCrateRootSourceFile(emission.configuration.foundation, [...errors.items, mainItem]),
    ));
  }
  const finalizedArtifacts = Object.freeze(artifacts.map((artifact) =>
    finalizeRustPlannedArtifact(
      artifact,
      emission.configuration.foundation,
    )));
  return resolvedTargetStage(Object.freeze({
        edition: emission.configuration.edition,
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
  completionType: import("../../target-ast/syntax/nodes.js").RustType,
  successfulCompletion: import("../../target-ast/syntax/nodes.js").RustExpr,
  epilogueStatements: readonly import("../../target-ast/syntax/nodes.js").RustStmt[],
  executeAsync: (future: import("../../target-ast/syntax/nodes.js").RustExpr) => import("../../target-ast/syntax/nodes.js").RustExpr,
): readonly import("../../target-ast/syntax/nodes.js").RustStmt[] | undefined {
  if (entries.length === 0) return Object.freeze([]);
  const mainErrorType = errors.errorType;
  const entryBySourceFile = new Map(entries.map((entry) =>
    [entry.sourceFile, entry] as const));
  const emission = input.program.records.programEmission.get();
  if (emission === undefined) failRustPlannerInvariant("An admitted worker dispatcher requires its sealed source contract.");
  const statements: import("../../target-ast/syntax/nodes.js").RustStmt[] = [];
  for (const [bootstrapIndex, selected] of emission.workerDispatch.entries()) {
    const bootstrap = selected.bootstrap;
    const selectedEntries = selected.targets.map(sourceFile => {
      const entry = entryBySourceFile.get(sourceFile);
      if (entry === undefined) failRustPlannerInvariant("An admitted worker dispatcher requires its selected entry.", sourceFile);
      return entry;
    }).sort((left, right) => left.identity.localeCompare(right.identity, "en"));
    const entryName = `worker_entry_selection_${bootstrapIndex + 1}`;
    const bootstrapCall = errors.lifecycle(
      { kind: "call", path: bootstrap.path, args: [] },
    );
    const unsupportedWorkerEntryError = {
      kind: "call" as const,
      path: "tsonic_rust_runtime::TsonicError::unsupported",
      args: [{
        kind: "str-literal" as const,
        value: "Worker process selected an entry absent from the closed generated dispatch table.",
      }],
    };
    const workerEntryError = errors.lifecycleError(unsupportedWorkerEntryError);
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
                : errors.lifecycle(execution);
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
  return Object.freeze(statements);
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

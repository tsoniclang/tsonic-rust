import {
  rejectedTargetStage,
  resolvedTargetStage,
} from "@tsonic/target-api/artifacts";
import {
  snapshotTargetPlanningSourceNavigation,
  targetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import type { SourceLiteralIndex } from "@tsonic/target-api/source";
import { analyzeRustProgram } from "./analyze.js";
import { analyzeRustNativeHandlers } from "../operations/native-handlers.js";
import { createRustProgramRecords } from "./records/create.js";
import type { RustAnalysisRecords } from "./records/model.js";
import { analyzeRustNumericRepresentations } from "../numeric/representations.js";
import { analyzeRustBinaryDispatchDemand } from "../project/binary-dispatch-demand.js";
import { createRustAnalysisContext } from "./context.js";
import type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";
import { analyzeRustCaptureStorage } from "../storage/capture-storage.js";
import { analyzeRustSettledPromiseBodies } from "../callables/async-results.js";
import { createRustModuleInitializationPlan } from "../module-initialization/analyze.js";
import { analyzeRustProviderErrorCarriers } from "./provider-errors.js";
import { analyzeRustDeclarationGenericRequirements } from "../declarations/generic-requirements.js";
import { analyzeRustOwnershipFlow } from "../ownership/flow.js";
import { analyzeRustReadOwnership } from "../ownership/reads.js";
import { analyzeRustLocalStorageAliases } from "../storage/local-aliases.js";
import { analyzeRustProjectConstructions } from "../project-types/construction-plan.js";
import { analyzeRustBorrowedElementReads } from "./borrowed-element-reads.js";
import { analyzeRustBorrowEffects } from "../ownership/effects.js";
import {
  analyzeRustBinaryHooks,
  analyzeRustDispatchContextCatalog,
  analyzeRustDispatchContextDemand,
  analyzeRustRuntimeReferences,
} from "../project/index.js";
import {
  analyzeRustEnumMemberConstants,
} from "../declarations/enum-member-constants.js";
import {
  analyzeRustSourcePackageFacades,
} from "./source-package-facades.js";
import {
  analyzeRustSourcePackageComponents,
} from "./source-package-components.js";
import {
  analyzeRustCountedLoopRepresentations,
} from "../control-flow/counted-loop-representations.js";
import { rustJsAsyncExecutor, rustJsEventLoopEpilogue, rustJsTimerDispatchContextId } from "../../providers/model/js-dispatch.js";
import { analyzeRustSourceModuleConstructions } from "../source-modules/index.js";
import { analyzeRustFoundation } from "../foundation/plan.js";
import { rustFoundationForCarrier } from "../foundation/requirements.js";
import { maximumRustFoundation } from "../../target-model/foundation/model.js";
import { analyzeRustProjectFlowReadSelections } from "../control-flow/project-flow-read-selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { analyzeRustErrorRegions, completeRustErrorRegionRecords } from "../errors/regions.js";
import { analyzeRustInitializationErrors } from "../errors/initialization.js";

import { rustTargetOperationIsFallible } from "../operations/target-operation.js";
import { analyzeRustErrorTransport } from "./error-transport.js";
import { analyzeRustBorrowedInitializers } from "../storage/borrowed-initializers.js";
import { createRustProviderMutableInputPlan } from "../storage/provider-mutable-inputs.js";
import { analyzeRustRetainedCallableInputs } from "../callables/retained-inputs.js";
import { analyzeRustGenericCallableErrors } from "../callables/generic-errors.js";
import { analyzeRustReachability } from "../reachability/plan.js";
import { rustNativeArgumentBorrowsRead } from "../ownership/uses.js";

export function analyzeRustTargetProgram(
  request: RustTargetAnalysisRequest,
): AnalyzeRustTargetProgramResult {
  const {
    input,
    configuration,
    providerSemantics,
    jsEnabled,
    rootPublishesLibrary,
  } = request;
  const runtimeReferences = analyzeRustRuntimeReferences(
    input.runtimeReferences,
    configuration.foundation,
  );
  if (runtimeReferences.kind === "rejected") {
    return rejectedTargetStage(runtimeReferences.diagnostics);
  }
  const dispatchContexts = analyzeRustDispatchContextCatalog(
    providerSemantics.dispatchContexts, runtimeReferences.plan.activeCrates,
  );
  if (dispatchContexts.kind === "rejected") return rejectedTargetStage(dispatchContexts.diagnostics);
  const runtimeActivatedCapabilities = new Set(input.runtimeActivatedCapabilityIds);
  const providerBinaryHooks = providerSemantics.binaryHooks.filter(row => runtimeActivatedCapabilities.has(row.providerPackageId));
  const activeProviderHooks = analyzeRustBinaryHooks(providerBinaryHooks, runtimeReferences.plan.activeCrates);
  const binaryHooks = analyzeRustBinaryHooks(
    jsEnabled ? [...providerBinaryHooks,
      ...(activeProviderHooks.some(hook => hook.phase === "after-entry" &&
        hook.dispatchGroups?.some(group => group.contextIds.includes(rustJsTimerDispatchContextId)))
        ? [] : [rustJsEventLoopEpilogue]),
      ...(activeProviderHooks.some(hook => hook.phase === "async-execution") ? [] : [rustJsAsyncExecutor])] : providerBinaryHooks,
    runtimeReferences.plan.activeCrates,
  );
  if (binaryHooks.filter(hook => hook.phase === "async-execution").length > 1) {
    return rejectedTargetStage([{
      code: "RUST_AMBIGUOUS_ASYNC_EXECUTOR", category: "error", source: "tsonic-rust",
      message: "An executable requires exactly one active provider async executor.",
      evidence: ["target.capability=rust.runtime.binary-hooks"],
    }]);
  }
  const context = createRustAnalysisContext(
    input,
    providerSemantics,
    jsEnabled,
    rootPublishesLibrary,
    dispatchContexts.plan,
  );
  if (context.diagnostics.length > 0) return rejectedTargetStage(context.diagnostics);
  const lexicalFunctions = analyzeRustProgram(context);
  if (context.diagnostics.length > 0) {
    return rejectedTargetStage(context.diagnostics);
  }
  if (lexicalFunctions === undefined) throw new Error("Rust program analysis completed without its sealed lexical callable index.");

  const sourcePackageFacades = analyzeRustSourcePackageFacades(context);
  if (sourcePackageFacades.kind === "rejected") {
    return rejectedTargetStage(sourcePackageFacades.diagnostics);
  }
  const sourcePackageComponents = analyzeRustSourcePackageComponents(
    context,
    configuration.outputType,
  );
  if (sourcePackageComponents.kind === "rejected") {
    return rejectedTargetStage(sourcePackageComponents.diagnostics);
  }
  context.callableValues.initializeCompletions({ ast: context.ast, sourceLifetimes: context.sourceLifetimes,
    records: context.records, physical: context.callableValues.generic.physical,
    producers: context.callableValues.nativeProducers, definitions: context.typeDefinitions,
    components: sourcePackageComponents.plan });
  context.structuralShapes.initializeUnions(context.typeDefinitions.generatedUnions());

  const classValues = context.classValues.seal(context);
  const moduleInitialization = createRustModuleInitializationPlan(context, classValues, {
    outputType: configuration.outputType,
    projectRoot: input.paths.projectRoot,
    entryPoint: input.project.entryPoint,
  });
  if (moduleInitialization.issues.length > 0) return rejectedTargetStage(moduleInitialization.issues.map(issue => ({
    code: issue.code, category: "error" as const, source: "tsonic-rust", sourceNode: issue.node,
    message: issue.message, evidence: issue.evidence,
  })));
  const objectRepresentations = context.objectRepresentations.seal();
  const foundation = analyzeRustFoundation({
    selected: configuration.foundation,
    factRequirement: context.typeDefinitions.definitionCarriers().map(rustFoundationForCarrier)
      .reduce(maximumRustFoundation, context.records.minimumFoundation()),
    runtimeReferenceRequirement: [...runtimeReferences.plan.minimumFoundationByCrate.values()]
      .reduce(maximumRustFoundation, "core"),
    moduleInitializationRequirement: moduleInitialization.minimumFoundation(),
    objectRepresentations,
    jsEnabled,
    binaryOutput: configuration.outputType === "bin",
  });
  if (foundation.plan === undefined) {
    return rejectedTargetStage(foundation.diagnostics);
  }
  const providerMutableInputs = createRustProviderMutableInputPlan({ ast: context.ast, records: context.records,
    navigation: context.source.navigation, nodes: context.sourceStorage.nodes });
  for (const node of context.sourceStorage.nodes) {
    const selection = providerMutableInputs.forOperation(node);
    if (selection?.kind === "rejected") context.diagnostics.push({ code: "RUST_PROVIDER_MUTABLE_INPUT_NOT_DISJOINT",
      category: "error", source: "tsonic-rust", message: selection.reason,
      sourceNode: selection.node,
      evidence: ["target.capability=rust.native-provider.disjoint-mutable-storage"] });
  }
  if (context.diagnostics.length > 0) return rejectedTargetStage(context.diagnostics);
  const retainedCallableInputs = analyzeRustRetainedCallableInputs({ ast: context.ast, records: context.records,
    storage: context.sourceStorage, native: context.callableValues.native, nativeStorage: context.callableValues.nativeStorage,
    components: sourcePackageComponents.plan });
  if (retainedCallableInputs.kind === "rejected") return retainedCallableInputs;
  analyzeRustNativeHandlers(context.sourceStorage.nodes, context.records, { get: context.safetyApplications.operationForExpression },
    context.source.sourceFacts, context.requiredRecords);
  const records = context.records.seal(context.requiredRecords);
  const projectConstructions = analyzeRustProjectConstructions({ ast: context.ast, records,
    typeDefinitions: context.typeDefinitions,
    projectTypes: context.projectTypes, receiverFieldAliases: objectRepresentations,
    receiverCaptures: objectRepresentations.receiverCaptures,
    mayThrow(node) {
      const accessor = records.sourceAccessorEffects.get(node);
      return records.sourceCallEffects.get(node)?.invocation === "fallible" ||
        accessor?.read === "fallible" || accessor?.write === "fallible" ||
        rustTargetOperationIsFallible(records.targetOperation.get(node), context.structuralShapes,
          context.projectFieldDispatch, context.frozenDataWrites, context.typeDefinitions);
    },
  });
  const dispatchContextDemand = analyzeRustDispatchContextDemand(
    context.ast, context.sourceFiles, records, sourcePackageComponents.plan, dispatchContexts.plan,
  );
  if (dispatchContextDemand.kind === "rejected") return rejectedTargetStage(dispatchContextDemand.diagnostics);
  const binaryDispatchDemand = analyzeRustBinaryDispatchDemand(
    binaryHooks, sourcePackageComponents.plan, dispatchContexts.plan, dispatchContextDemand.plan,
  );
  if (binaryDispatchDemand.kind === "rejected") return rejectedTargetStage(binaryDispatchDemand.diagnostics);
  const capturesFor = (closure: import("@tsonic/tsts").Node) => {
      const existing = records.closureCapture.get(closure);
      if (existing !== undefined) return existing;
      const selection = lexicalFunctions.forDeclaration(closure);
      if (selection?.kind !== "resolved") return undefined;
      const captures: import("../../target-model/records/operation-selections.js").RustClosureCaptureFact["captures"][number][] = [];
      for (const capture of selection.captures) {
        const carrier = records.runtimeCarrier.get(capture.declaration)?.carrier ??
          records.runtimeCarrier.get(capture.reference)?.carrier;
        const storage = records.bindingStorage.get(capture.declaration)?.storage ?? "value";
        if (carrier === undefined) return undefined;
        captures.push({ declaration: capture.declaration, reference: capture.reference, carrier, storage });
      }
      return { receivers: [], receiverFields: [], captures };
  };
  const ownershipFlow = analyzeRustOwnershipFlow({
    source: context.source,
    storage: context.sourceStorage,
    capturesFor,
    mayBorrowArgument: (argument, reference) => !projectConstructions.ownsExternalArgument(argument) &&
      rustNativeArgumentBorrowsRead(argument, reference, context.ast, records),
    isInstanceFieldUse: (reference, declaration) => {
      const operation = records.targetOperation.get(reference);
      return operation?.kind === "source-field" && operation.declaration === declaration;
    },
    isOnceCallable: (closure) => {
      const carrier = records.runtimeCarrier.get(closure)?.carrier;
      const selection = lexicalFunctions.forDeclaration(closure);
      return carrier?.kind === "closure" && carrier.callTrait === "FnOnce" ||
        selection?.kind === "resolved" && selection.captureRoots.every(root => {
          const captured = lexicalFunctions.forDeclaration(root);
          return captured?.kind === "resolved" && captured.singleInvocation;
        });
    },
    isOwnedOperationResult: (expression) => {
      const operation = records.targetOperation.get(expression);
      return operation?.kind === "source-field" && operation.valueSemantics.kind === "accessor" && operation.accessMode === "read" ||
        operation?.kind === "provider-operation" &&
        (operation.abi.target.form === "method" || operation.abi.target.form === "call" ||
          operation.abi.target.form === "receiver-method" || operation.abi.target.form === "associated-call") &&
        operation.abi.result.kind === "sync" && operation.abi.result.carrier.kind !== "reference" &&
        rustTargetTypeRefEquals(operation.abi.result.carrier, records.runtimeCarrier.get(expression)?.carrier);
    },
    canMoveStoredField: (field) => {
      const selected = records.targetOperation.get(field);
      if (selected?.kind !== "source-field" || selected.storage !== "project-object" ||
        selected.valueSemantics.kind !== "stored" || selected.dispatch !== undefined) return false;
      const definition = context.projectTypes.definitionForCarrier(selected.receiverCarrier);
      if (definition === undefined ||
        objectRepresentations.representationFor(definition)?.kind !== "value") return false;
      const semantics = context.semanticsFor(field).operations;
      const access = semantics.propertyAccess(field) ?? semantics.elementAccess(field);
      if (access === undefined || records.runtimeCarrier.get(access.receiver.expression)?.carrier.kind === "reference") return false;
      const declaration = access.receiver.valueDeclaration;
      return declaration === undefined || records.bindingStorage.get(declaration) === undefined;
    },
  });
  if (ownershipFlow.kind === "rejected") return rejectedTargetStage(ownershipFlow.diagnostics);
  const errorRegions = analyzeRustErrorRegions({ ast: context.ast, sourceFiles: context.sourceFiles, records,
    names: context.names, callables: context.callableValues.selected,
    producers: context.callableValues.nativeProducers, definitions: context.typeDefinitions,
    components: sourcePackageComponents.plan });
  if (errorRegions.kind === "rejected") return errorRegions;
  const declarationGenericRequirements = analyzeRustDeclarationGenericRequirements(
    context.source,
    context.sourceFiles,
    records,
    context.names,
    context.sourceLifetimes,
    context.typeFamilies,
    context.projectTypes,
    context.structuralShapes,
    context.typeDefinitions,
    ownershipFlow.flow,
    objectRepresentations,
    context.callableValues.generic,
    classValues.instanceViews,
    context.callableValues.selected.frames,
    context.callableValues.native,
    errorRegions.value,
  );
  if (declarationGenericRequirements.kind === "rejected") {
    return rejectedTargetStage(declarationGenericRequirements.diagnostics);
  }
  const sourceModuleConstructions = analyzeRustSourceModuleConstructions({
    source: context.source,
    sourceFiles: context.sourceFiles,
    records,
    outputType: configuration.outputType,
  });
  if (sourceModuleConstructions.issues.length > 0) {
    return rejectedTargetStage(sourceModuleConstructions.issues.map((issue) => ({
      code: issue.code,
      category: "error" as const,
      source: "tsonic-rust",
      message: issue.message,
      sourceNode: issue.node,
      evidence: ["target.capability=rust.backend.source-module-construction"],
    })));
  }
  const borrowedElementReads = analyzeRustBorrowedElementReads(context.ast, context.sourceFiles, records, context.source.navigation);
  const borrowEffectsInput = {
    sourceFacts: context.source.sourceFacts,
    ast: context.ast, nodes: context.sourceStorage.nodes, records, navigation: context.source.navigation,
    projectTypes: context.projectTypes, objectRepresentations, frozenDataWrites: context.frozenDataWrites,
    structuralShapes: context.structuralShapes,
  };
  const borrowEffects = analyzeRustBorrowEffects(borrowEffectsInput);
  if (borrowEffects.kind === "rejected") return rejectedTargetStage(borrowEffects.diagnostics);
  const ownership = analyzeRustReadOwnership({ storage: context.sourceStorage, records,
    flow: ownershipFlow.flow, borrowEffects: borrowEffects.effects, borrowEffectsInput, definitions: context.typeDefinitions,
    genericRequirements: declarationGenericRequirements.index, genericCallables: context.callableValues.generic,
    capturesFor, invocationTransfersCapture: owner => {
      const selected = lexicalFunctions.forDeclaration(owner);
      return selected?.kind !== "resolved" || !selected.valueObserved && selected.singleInvocation;
    } });
  if (ownership.kind === "rejected") return rejectedTargetStage(ownership.diagnostics);
  const typeDefinitions = context.typeDefinitions.seal();
  const projectTypes = context.projectTypes.seal();
  const errorTransport = analyzeRustErrorTransport({ ast: context.ast, projectTypes, typeDefinitions,
    sourcePackageComponents: sourcePackageComponents.plan, errorStorageDemands: context.errorStorageDemands });
  if (errorTransport.kind === "rejected") return rejectedTargetStage(errorTransport.diagnostics);
  const genericCallableErrors = analyzeRustGenericCallableErrors({ ast: context.ast, sourceLifetimes: context.sourceLifetimes,
    physical: context.callableValues.generic.physical, producers: context.callableValues.nativeProducers,
    effectsFor: declaration => records.sourceCallEffects.get(declaration) });
  if (genericCallableErrors.kind === "rejected") return genericCallableErrors;
  const initializationErrors = analyzeRustInitializationErrors({ ast: context.ast, sourceFiles: context.sourceFiles,
    navigation: context.source.navigation, moduleInitialization, sourceModules: sourceModuleConstructions.index,
    components: sourcePackageComponents.plan, facades: sourcePackageFacades.plan, regions: errorRegions.value,
    binaryHooks, outputType: configuration.outputType, projectRoot: input.paths.projectRoot,
    entryPoint: input.project.entryPoint });
  if (initializationErrors.kind === "rejected") return initializationErrors;
  const finalRecords = Object.freeze({ ...records, literalValue: context.literalValues.literalValue });
  const program: Omit<RustTargetProgram, "reachability" | "records"> & {
    readonly records: RustAnalysisRecords & SourceLiteralIndex;
  } = {
    errorRegions: completeRustErrorRegionRecords(errorRegions.value, initializationErrors.value),
    genericCallableErrors: genericCallableErrors.value,
    captureStorage: analyzeRustCaptureStorage({ ast: context.ast, sourceFiles: context.sourceFiles, records }),
    settledPromiseBodies: analyzeRustSettledPromiseBodies({ ast: context.ast, sourceFiles: context.sourceFiles,
      records, names: context.names }),
    lexicalFunctions,
    errorStorageDemands: context.errorStorageDemands,
    localStorageAliases: analyzeRustLocalStorageAliases({ ast: context.ast,
      navigation: context.source.navigation, sourceFiles: context.sourceFiles, records }),
    numericRepresentations: analyzeRustNumericRepresentations({ source: context.source,
      sourceFiles: context.sourceFiles, records }),
    host: Object.freeze({
      paths: Object.freeze({ ...input.paths }),
      entryPoint: input.project.entryPoint,
      sourcePackages: input.sourcePackages,
    }),
    configuration,
    source: targetSourceSyntaxProgram(context.source),
    sourceNavigation: snapshotTargetPlanningSourceNavigation(context.source),
    sourceFiles: context.sourceFiles,
    records: finalRecords,
    typeFamilies: context.typeFamilies.seal(),
    typeDefinitions,
    projectTypes,
    errorTransport: errorTransport.value,
    objectRepresentations,
    projectMethodDispatch: context.projectMethodDispatch.seal(),
    projectConstructions,
    projectMethodProperties: context.projectMethodProperties.seal(),
    projectFieldDispatch: context.projectFieldDispatch.seal(),
    sourceCallableSpecializations: context.sourceCallableSpecializations.seal(),
    callableValues: context.callableValues.seal(),
    callableOwnership: context.callableOwnership.seal(),
    sourceLifetimes: context.sourceLifetimes,
    declarationGenericRequirements: declarationGenericRequirements.index,
    ownership: ownership.ownership,
    borrowedElementReads,
    borrowedInitializers: analyzeRustBorrowedInitializers(context.ast, context.sourceFiles, records),
    providerMutableInputs,
    retainedCallableInputs: retainedCallableInputs.value,
    structuralShapes: context.structuralShapes.seal(),
    frozenDataWrites: context.frozenDataWrites.seal(),
    classValues,
    runtimeReferences: runtimeReferences.plan,
    dispatchContexts: dispatchContexts.plan,
    dispatchContextDemand: dispatchContextDemand.plan,
    binaryDispatchDemand: binaryDispatchDemand.plan,
    foundation: foundation.plan,
    binaryHooks,
    providerErrorCarriers: analyzeRustProviderErrorCarriers(
      context.ast,
      context.sourceFiles,
      records,
      binaryHooks,
    ),
    safetyApplications: context.safetyApplications,
    moduleInitialization,
    names: context.names,
    enumMemberConstants: analyzeRustEnumMemberConstants(
      context.source,
      context.sourceFiles,
    ),
    sourcePackageFacades: sourcePackageFacades.plan,
    sourcePackageComponents: sourcePackageComponents.plan,
    countedLoops: analyzeRustCountedLoopRepresentations({
      ast: context.ast,
      sourceFiles: context.sourceFiles,
      navigation: context.source.navigation,
      records: finalRecords,
      borrowedElementReads,
    }),
    projectFlowReadSelections: analyzeRustProjectFlowReadSelections({
      ast: context.ast,
      sourceFiles: context.sourceFiles,
      records,
    }),
    sourceModuleConstructions: sourceModuleConstructions.index,
    generatedDeclarationUses: context.generatedDeclarationUses.seal(),
  };
  const reachability = analyzeRustReachability(program);
  context.callableValues.publish();
  return resolvedTargetStage(Object.freeze({ ...program,
    records: Object.freeze({ ...createRustProgramRecords(records), literalValue: context.literalValues.literalValue }),
    reachability }));
}

export type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";

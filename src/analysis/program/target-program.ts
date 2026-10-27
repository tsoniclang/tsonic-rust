import { finalizeRustNativeEmission } from "./emission.js";
import { rejectedTargetStage, resolvedTargetStage, type TargetStageResult, failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { snapshotTargetPlanningSourceNavigation, targetSourceSyntaxProgram } from "@tsonic/target-api/analysis";
import { asSourceNode, type SourceLiteralIndex } from "@tsonic/target-api/source";
import { analyzeRustProgram } from "./analyze.js";
import { createRustProgramRecords } from "./records/create.js";
import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";
import { analyzeRustNumericRepresentations } from "../numeric/representations.js";
import { analyzeRustBinaryDispatchDemand } from "../project/binary-dispatch-demand.js";
import { createRustAnalysisContext } from "./context.js";
import type { AnalyzeRustTargetProgramResult, RustTargetAnalysisRequest, RustAnalysisProgram, RustCompleteAnalysisProgram } from "./model.js";
import type { RustTargetProgram } from "../../target-model/records/target-program.js";
import { analyzeRustCaptureStorage } from "../storage/capture-storage.js";

import { analyzeRustGenericAdoption, analyzeRustPromiseResults } from "../callables/promise-results.js";
import { publishRustNativeTaskUses } from "../callables/native-task-uses.js";
import { analyzeRustLexicalFunctionEmission } from "../callables/lexical-emission.js";
import { prepareRustCallableEntryParameters } from "../callables/entry-parameters.js";
import { createRustCallableEntryHeaderPlacements } from "../callables/entry-header-placements.js";
import { prepareRustClassImplementationContexts } from "../objects/class-implementation-contexts.js";
import { prepareRustProjectGenericMembership } from "../project-types/generic-membership.js";
import { createRustModuleInitializationPlan } from "../module-initialization/analyze.js";
import { analyzeRustProviderErrorCarriers } from "./provider-errors.js";
import { analyzeRustDeclarationGenericRequirements } from "../declarations/generic-requirements.js";
import { analyzeRustOwnershipFlow } from "../ownership/flow.js";

import { prepareRustReadOwnership } from "../ownership/reads.js";
import { analyzeRustLocalStorageAliases } from "../storage/local-aliases.js";
import { analyzeRustProjectConstructions } from "../project-types/construction-plan.js";
import { analyzeRustBorrowedElementReads } from "../storage/borrowed-element-reads.js";
import { analyzeRustBorrowEffects } from "../ownership/effects.js";
import { analyzeRustBinaryHooks, analyzeRustDispatchContextCatalog, analyzeRustDispatchContextDemand, analyzeRustRuntimeReferences } from "../project/index.js";
import { analyzeRustSourcePackageFacades } from "../source-modules/facade-contracts.js";

import { validateRustGenericSourcePackageComponents } from "../source-modules/component-semantics.js";
import { analyzeRustCountedLoopRepresentations } from "../control-flow/counted-loop-representations.js";
import { rustJsAsyncExecutor, rustJsEntryOwner } from "../../providers/model/js-dispatch.js";
import { analyzeRustBinaryExecution } from "../project/binary-execution.js";
import { analyzeRustSourceModuleConstructions } from "../source-modules/index.js";
import { analyzeRustFoundation } from "../foundation/plan.js";
import { finalizeRustFoundation } from "../foundation/finalization.js";
import { rustFoundationForCarrier } from "../foundation/requirements.js";
import { maximumRustFoundation } from "../../target-model/foundation/model.js";
import { analyzeRustProjectFlowReadSelections } from "../control-flow/project-flow-read-selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { analyzeRustErrorRegions, completeRustErrorRegionRecords } from "../errors/regions.js";
import type { RustErrorTypeContext } from "../errors/error-types.js";
import { analyzeRustInitializationErrors } from "../errors/initialization.js";

import { rustTargetOperationIsFallible } from "../../policy/operations/members/native-contracts.js";
import { analyzeRustErrorTransport } from "../errors/transport.js";
import { analyzeRustBorrowedInitializers } from "../storage/borrowed-initializers.js";

import { analyzeRustSourceOutputIdentities } from "../names/source-output-identities.js";
import { analyzeRustRetainedCallableInputs } from "../callables/retained-inputs.js";
import { analyzeRustGenericCallableErrors } from "../callables/generic-errors.js";

import { analyzeRustReadUses, rustNativeArgumentBorrowsRead } from "../ownership/uses.js";
import { analyzeRustStatementCompletions } from "../control-flow/statement-completion.js";
import { analyzeRustStatementExits } from "../control-flow/statement-exits.js";
import { analyzeRustExpressionExits } from "../control-flow/expression-exits.js";
import { eraseRustCompileTimeVariableStatements } from "../control-flow/compile-time-statements.js";
import { analyzeRustResourceScopes } from "../control-flow/resource-scopes.js";
import { rustReferentWriteRequiresMutableBinding } from "../ownership/source-writes.js";

/** Seals the analysis program into the data-only program the backend plans from. */
export function analyzeRustTargetProgram(
  request: RustTargetAnalysisRequest,
): AnalyzeRustTargetProgramResult {
  const analysis = analyzeRustAnalysisProgram(request);
  if (analysis.kind === "rejected") return analysis;
  return resolvedTargetStage(sealRustAnalysisProgram(analysis.value), analysis.diagnostics);
}

/** The sealed target program the planner receives: the host, the syntax reader and the sealed records only. */
export function sealRustAnalysisProgram(program: RustCompleteAnalysisProgram): RustTargetProgram {
  const { host, source, records } = program;
  return Object.freeze({ host, source: Object.freeze({ ast: source.ast }), records });
}

/** The complete analysis program: every plan and record the analysis publishes, before sealing. */
export function analyzeRustAnalysisProgram(
  request: RustTargetAnalysisRequest,
): TargetStageResult<RustCompleteAnalysisProgram> {
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
    request.runtimeCrates,
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
      ...(activeProviderHooks.some(hook => hook.phase === "entry-execution") ? [] : [rustJsEntryOwner]),
      ...(activeProviderHooks.some(hook => hook.phase === "async-entry-execution") ? [] : [rustJsAsyncExecutor])] : providerBinaryHooks,
    runtimeReferences.plan.activeCrates,
  );
  if (input.source.semantics.enumConstants.issues.length !== 0) return rejectedTargetStage(input.source.semantics.enumConstants.issues);
  const contextResult = createRustAnalysisContext(
    input,
    providerSemantics,
    jsEnabled,
    rootPublishesLibrary,
    dispatchContexts.plan,
  );
  if (contextResult.kind === "rejected") return contextResult;
  const context = contextResult.value;
  if (context.diagnostics.length > 0) return rejectedTargetStage(context.diagnostics);
  const genericAdoption = analyzeRustGenericAdoption({ source: context.source, projectRoot: input.paths.projectRoot,
    storage: context.sourceStorage, sourceLifetimes: context.sourceLifetimes });
  if (genericAdoption.length !== 0) return rejectedTargetStage(genericAdoption);
  const sourceOutputIdentities = analyzeRustSourceOutputIdentities({ ast: context.ast,
    sourceFiles: context.sourceFiles, paths: input.paths, sourcePackages: input.sourcePackages });
  if (sourceOutputIdentities.kind === "rejected") return rejectedTargetStage(sourceOutputIdentities.diagnostics);
  const sourceStage = analyzeRustProgram(context, configuration.outputType);
  if (context.diagnostics.length > 0) {
    return rejectedTargetStage(context.diagnostics);
  }
  if (sourceStage === undefined) failTargetAnalysisInvariant("tsonic-rust", "Rust program analysis completed without its sealed source-stage output.");
  const { lexicalFunctions, sourcePackageComponents } = sourceStage;

  const sourcePackageFacades = analyzeRustSourcePackageFacades(context);
  if (sourcePackageFacades.kind === "rejected") {
    return rejectedTargetStage(sourcePackageFacades.diagnostics);
  }
  const genericComponentDiagnostics = validateRustGenericSourcePackageComponents(context, sourcePackageComponents);
  if (genericComponentDiagnostics.length !== 0) return rejectedTargetStage(genericComponentDiagnostics);
  context.callableValues.initializeCompletions({ ast: context.ast, sourceLifetimes: context.sourceLifetimes,
    records: context.records, physical: context.callableValues.generic.physical,
    producers: context.callableValues.nativeProducers, definitions: context.typeDefinitions,
    components: sourcePackageComponents });
  context.structuralShapes.initializeUnions(context.typeDefinitions.generatedUnions());

  const classValues = context.classValues.seal(context);
  const classContexts = prepareRustClassImplementationContexts({ source: context.source, records: context.records, projectTypes: context.projectTypes, classValues },
    context.records.classEmissionPlans, context.nativeNodes);
  const moduleInitialization = createRustModuleInitializationPlan(context, classValues, {
    outputType: configuration.outputType,
    projectRoot: input.paths.projectRoot,
    entryPoint: input.project.entryPoint,
  }, sourceStage.moduleCycles);
  if (moduleInitialization.issues.length > 0) return rejectedTargetStage(moduleInitialization.issues.map(issue => ({
    code: issue.code, category: "error" as const, source: "tsonic-rust", sourceNode: issue.node,
    message: issue.message, evidence: issue.evidence,
  })));
  const objectRepresentations = context.objectRepresentations.seal();
  context.records.mutatedReferents.finalizeBindings((declaration, writes) => {
    // Only local variables and parameters own a Rust binding whose mutability a referent write decides; an import
    // binding of a provider module object has no Rust binding.
    if (!context.ast.is.IsVariableDeclaration(declaration) && !context.ast.is.IsParameterDeclaration(declaration) &&
      !context.ast.is.IsBindingElement(declaration)) return false;
    // A variable declared by a provider or profile declaration file (`declare var process`) is not a Rust binding either.
    if (context.ast.getSourceFile(declaration)?.IsDeclarationFile === true) return false;
    const isSharedObject = (selected: import("../../target-model/types/model.js").TargetTypeRef): boolean => {
      const representation = objectRepresentations.representationFor(context.projectTypes.definitionForCarrier(selected));
      return representation !== undefined && (representation.kind !== "value" || !representation.mutable);
    };
    return writes.map(write => rustReferentWriteRequiresMutableBinding(context.records, write, isSharedObject)).some(Boolean);
  });
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
  const retainedCallableInputs = analyzeRustRetainedCallableInputs({ ast: context.ast, records: context.records,
    nativeNodes: context.nativeNodes,
    storage: context.sourceStorage, native: context.callableValues.native, nativeStorage: context.callableValues.nativeStorage,
    components: sourcePackageComponents });
  if (retainedCallableInputs.kind === "rejected") return retainedCallableInputs;
  const records = context.records.readers;
  const projectConstructions = analyzeRustProjectConstructions({ ast: context.ast, records,
    isNativeNode: context.isNativeNode,
    typeDefinitions: context.typeDefinitions,
    projectTypes: context.projectTypes, objectRepresentations, frames: context.callableValues.selected.frames,
    mayThrow(node) {
      const accessor = records.sourceAccessorEffects.get(node);
      return records.sourceCallEffects.get(node)?.invocation === "fallible" ||
        accessor?.read === "fallible" || accessor?.write === "fallible" ||
        rustTargetOperationIsFallible(records.targetOperation.get(node), context.structuralShapes.completed,
          context.projectFieldDispatch, context.frozenDataWrites, context.typeDefinitions);
    },
  });
  const dispatchContextDemand = analyzeRustDispatchContextDemand(
    context.ast, context.sourceFiles, records, sourcePackageComponents, context.isNativeNode, dispatchContexts.plan,
    binaryHooks.flatMap(hook => hook.dispatchGroups.flatMap(group => group.contextIds)),
  );
  if (dispatchContextDemand.kind === "rejected") return rejectedTargetStage(dispatchContextDemand.diagnostics);
  const binaryDispatchDemand = analyzeRustBinaryDispatchDemand(
    binaryHooks, sourcePackageComponents, dispatchContexts.plan, dispatchContextDemand.plan,
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
  const readUses = analyzeRustReadUses(context.ast, context.nativeNodes, records, context.typeDefinitions,
    projectConstructions.ownsExternalArgument, context.structuralShapes.completed, node => {
      const field = records.targetOperation.get(node);
      return field?.kind === "source-field" && (field.storage === "structural-object"
        ? rustStructuralObjectCarrierValue(field.receiverCarrier)?.representation === "value"
        : objectRepresentations.representationFor(context.projectTypes.definitionForCarrier(field.receiverCarrier))?.kind === "value") &&
        (field.declaration === undefined || context.callableValues.frames.bindingFor(field.declaration) === undefined &&
          records.capturedFieldStorage.get(field.declaration) === undefined);
    });
  const ownershipFlow = analyzeRustOwnershipFlow({
    source: context.source,
    storage: context.sourceStorage,
    nativeNodes: context.nativeNodes,
    uses: readUses,
    capturesFor,
    sourceCallableFor: invocation => asSourceNode(records.selectedCall.get(invocation)?.sourceDeclaration, context.ast),
    mayBorrowArgument: (argument, reference) => !projectConstructions.ownsExternalArgument(argument) &&
      rustNativeArgumentBorrowsRead(argument, reference, context.ast, records),
    isInstanceFieldUse: (reference, declaration) => {
      const operation = records.targetOperation.get(reference);
      return operation?.kind === "source-field" && operation.declaration === declaration;
    },
    lexicalFunctions,
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
  const errorTypes = { ast: context.ast, records, producers: context.callableValues.nativeProducers,
    definitions: context.typeDefinitions, components: sourcePackageComponents } satisfies RustErrorTypeContext;
  const errorRegions = analyzeRustErrorRegions({ ...errorTypes, sourceFiles: context.sourceFiles,
    isNativeNode: context.isNativeNode,
    promiseBodies: context.promiseBodies.plan,
    nativeTasks: sourceStage.nativeTaskCompletions,
    binaryHooks,
    names: context.names, callables: context.callableValues.selected });
  if (errorRegions.kind === "rejected") return errorRegions;
  context.callableValues.finalizeStructuralStorage(errorRegions.value);
  const borrowedElementReads = analyzeRustBorrowedElementReads(context.ast, context.nativeNodes, records, context.source.navigation);
  context.records.borrowedElements.publish(context.nativeNodes, borrowedElementReads);
  const borrowEffectsInput = {
    isNativeNode: context.isNativeNode,
    sourceFacts: context.source.sourceFacts,
    ast: context.ast, nodes: context.nativeNodes, records, navigation: context.source.navigation,
    projectTypes: context.projectTypes, objectRepresentations, frozenDataWrites: context.frozenDataWrites,
    structuralShapes: context.structuralShapes.completed,
  };
  const borrowEffects = analyzeRustBorrowEffects(borrowEffectsInput, readUses);
  if (borrowEffects.kind === "rejected") return rejectedTargetStage(borrowEffects.diagnostics);
  const preparedOwnership = prepareRustReadOwnership({ storage: context.sourceStorage, nativeNodes: context.nativeNodes, records, uses: readUses,
    flow: ownershipFlow.flow, borrowEffects: borrowEffects.effects, borrowEffectsInput, definitions: context.typeDefinitions,
    genericCallables: context.callableValues.generic,
    capturesFor, invocationTransfersCapture: owner => {
      const selected = lexicalFunctions.forDeclaration(owner);
      return selected?.kind !== "resolved" || !selected.valueObserved && selected.singleInvocation;
    } });
  if (preparedOwnership.kind === "rejected") return rejectedTargetStage(preparedOwnership.diagnostics);
  const declarationGenericRequirements = analyzeRustDeclarationGenericRequirements(
    context.source,
    context.nativeNodes,
    records,
    context.names,
    context.sourceLifetimes,
    context.typeFamilies,
    context.projectTypes,
    context.structuralShapes.completed,
    context.typeDefinitions,
    ownershipFlow.flow,
    objectRepresentations,
    context.callableValues.generic,
    classValues.instanceViews,
    context.callableValues.selected.frames,
    context.callableValues.native,
    errorRegions.value,
    context.promiseBodies.plan,
    context.callableValues.nativeStorage,
    context.callableValues.selected.projectFieldStorage,
    classValues,
    errorTypes,
    preparedOwnership.borrowFor,
  );
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
  analyzeRustCaptureStorage({ ast: context.ast, nativeNodes: context.nativeNodes, records, producer: context.records.captureStorage });
  const typeDefinitions = context.typeDefinitions.seal();
  const projectTypes = context.projectTypes.seal();
  const errorTransport = analyzeRustErrorTransport({ ast: context.ast, projectTypes, typeDefinitions,
    sourcePackageComponents, errorStorageDemands: context.errorStorageDemands });
  if (errorTransport.kind === "rejected") return rejectedTargetStage(errorTransport.diagnostics);
  const genericCallableErrors = analyzeRustGenericCallableErrors({ ast: context.ast, sourceLifetimes: context.sourceLifetimes,
    physical: context.callableValues.generic.physical, producers: context.callableValues.nativeProducers,
    effectsFor: declaration => records.sourceCallEffects.get(declaration) });
  if (genericCallableErrors.kind === "rejected") return genericCallableErrors;
  const initializationErrors = analyzeRustInitializationErrors({ ast: context.ast, sourceFiles: context.sourceFiles,
    navigation: context.source.navigation, moduleInitialization, sourceModules: sourceModuleConstructions.index,
    components: sourcePackageComponents, facades: sourcePackageFacades.plan, regions: errorRegions.value,
    lifecycleFor: errorRegions.value.lifecycleFor, nativeTasks: sourceStage.nativeTaskCompletions.length !== 0,
    binaryHooks, outputType: configuration.outputType, projectRoot: input.paths.projectRoot,
    entryPoint: input.project.entryPoint });
  if (initializationErrors.kind === "rejected") return initializationErrors;
  const taskUses = publishRustNativeTaskUses({ context, graph: sourceStage.nativeTasks, completions: sourceStage.nativeTaskCompletions,
    regions: errorRegions.value, initialization: initializationErrors.value });
  if (taskUses.kind === "rejected") return taskUses;
  const promiseResultsFor = (nativeStorageValidated: boolean,
    nativeHeaders: Parameters<typeof analyzeRustPromiseResults>[0]["nativeHeaders"]) => analyzeRustPromiseResults({ ast: context.ast, source: context.source, genericAdoption,
    storage: context.sourceStorage,
    nodes: context.nativeNodes, records, readFor: node => preparedOwnership.readFor(node, declarationGenericRequirements),
    uses: context.promiseResultUses, definitions: context.typeDefinitions,
    nativeStorage: context.callableValues.nativeStorage, native: context.callableValues.native,
    nativeProducers: context.callableValues.nativeProducers, nativeHeaders,
    sourceSpecializations: context.sourceCallableSpecializations,
    promiseBodies: context.promiseBodies.plan,
    nativeCaptures: context.callableValues.selected.nativeCaptures, errorTypes,
    sourceTypes: sourceStage.sourceTypes,
    sourceLifetimes: context.sourceLifetimes, requirements: declarationGenericRequirements, nativeStorageValidated, families: context.typeFamilies, jsEnabled: context.jsEnabled,
    evidence: { genericCallables: context.callableValues.generic, frameCallables: context.callableValues.selected.frames,
      classValues, objectRepresentations, structuralShapes: context.structuralShapes.completed, projectTypes: context.projectTypes, records,
      projectFieldStorage: context.callableValues.selected.projectFieldStorage } });
  if (declarationGenericRequirements.kind === "rejected") {
    const promiseResults = promiseResultsFor(false, { kind: "unresolved", at: context.sourceFiles[0]!,
      reason: "Native pending storage requires its completed original generic entry contracts." });
    return rejectedTargetStage([...declarationGenericRequirements.diagnostics, ...promiseResults.diagnostics]);
  }
  const ownership = preparedOwnership.complete(declarationGenericRequirements.index);
  if (ownership.kind === "rejected") return rejectedTargetStage(ownership.diagnostics);
  const projectGenericMemberships = prepareRustProjectGenericMembership(declarationGenericRequirements.index);
  analyzeRustLexicalFunctionEmission({ program: { records, lexicalFunctions, ownership: ownership.ownership,
    callableValues: context.callableValues }, nodes: context.nativeNodes, producer: context.records.lexicalFunctionPlans });
  const callableEntries = prepareRustCallableEntryParameters({ source: context.source, nodes: context.nativeNodes, records,
    requirements: declarationGenericRequirements.index,
    lifetimes: context.sourceLifetimes, nativeStorage: context.callableValues.nativeStorage, native: context.callableValues.native,
    nativeProducers: context.callableValues.nativeProducers,
    generic: context.callableValues.generic,
    frames: context.callableValues.frames, classValues,
    projectTypes: context.projectTypes, structuralShapes: context.structuralShapes.completed,
    producer: context.records.declarationEmission, required: context.requiredRecords });
  if (callableEntries.kind === "rejected") return callableEntries;
  const headerPlacements = createRustCallableEntryHeaderPlacements({ program: { source: context.source,
    records, promiseBodies: context.promiseBodies.plan, projectTypes: context.projectTypes, names: context.names,
    sourceCallableSpecializations: context.sourceCallableSpecializations,
    callableValues: { frames: context.callableValues.frames, generic: context.callableValues.generic } }, entries: callableEntries.value,
    classContexts, memberships: projectGenericMemberships });
  analyzeRustBorrowedInitializers(context.ast, context.nativeNodes, records, ownership.ownership.reads, context.records.borrowedInitializers);
  const retentionIssues = context.callableValues.validateStructuralRetention(declarationGenericRequirements.index, context.typeFamilies, classValues, errorTypes);
  const promiseResults = promiseResultsFor(retentionIssues.length === 0, headerPlacements);
  if (retentionIssues.length !== 0 || promiseResults.diagnostics.length > 0) {
    return rejectedTargetStage([...retentionIssues.map(issue => ({ code: "RUST_CALLABLE_VALUE_NOT_CLOSED", category: "error" as const,
      source: "tsonic-rust", message: issue.message, sourceNode: issue.subject,
      evidence: ["target.capability=rust.callable-value.exact-implementation"] })), ...promiseResults.diagnostics]);
  }
  const binaryExecution = analyzeRustBinaryExecution({ hooks: binaryHooks, outputType: configuration.outputType,
    jsEnabled, asynchronous: sourceStage.nativeTaskCompletions.length !== 0 || initializationErrors.value.root.asynchronous ||
      initializationErrors.value.workers.some(worker => worker.initializer.asynchronous) });
  if (binaryExecution.kind === "rejected") return binaryExecution;
  analyzeRustExpressionExits({ source: context.source, records }, context.nativeNodes, context.records.expressionExitPlans);
  analyzeRustStatementExits({ source: context.source, nodes: context.nativeNodes, sourceFiles: context.sourceFiles, records,
    producer: context.records.statementExits, required: context.requiredRecords });
  eraseRustCompileTimeVariableStatements({ ast: context.ast, nodes: context.nativeNodes, records,
    producer: context.records.compileTimeSources, required: context.requiredRecords });
  analyzeRustResourceScopes({ ast: context.ast, nodes: context.nativeNodes, records,
    producer: context.records.resourceScopes, required: context.requiredRecords });
  context.records.ownershipEmissionPlans.publish(ownership.ownership);
  const finalRecords = Object.freeze({ ...records, literalValue: context.literalValues.literalValue });
  const completedErrorRegions = completeRustErrorRegionRecords(errorRegions.value, initializationErrors.value);
  const projectFlowReadSelections = analyzeRustProjectFlowReadSelections({ ast: context.ast, sourceFiles: context.sourceFiles,
    isNativeNode: context.isNativeNode, records });
  const callableValues = context.callableValues.seal({
    callableEntries: callableEntries.value,
    nativeGenerics: context.records.nativeGenericPlans,
    declarationGenericRequirements: declarationGenericRequirements.index, genericErrors: genericCallableErrors.value,
    retainedCallableInputs: retainedCallableInputs.value,
    errorRegions: completedErrorRegions, initialization: initializationErrors.value,
    constructions: context.projectTypes.definitions.flatMap(definition => {
      const plan = projectConstructions.forDefinition(definition);
      return plan === undefined ? [] : [plan];
    }) });
  if (callableValues.kind === "rejected") return callableValues;
  const statementCompletions = analyzeRustStatementCompletions({ source: context.source, sourceFiles: context.sourceFiles,
    isNativeNode: context.isNativeNode,
    records, names: context.names, typeDefinitions, errorRegions: completedErrorRegions, projectFlowReadSelections,
    producer: context.records.statementCompletions, required: context.requiredRecords,
    safetyApplications: context.safetyApplications,
    components: sourcePackageComponents,
    ownership: ownership.ownership, projectTypes, projectFieldDispatch: context.projectFieldDispatch,
    structuralShapes: context.structuralShapes.completed, frozenDataWrites: context.frozenDataWrites,
    countedLoops: analyzeRustCountedLoopRepresentations({ ast: context.ast, nativeNodes: context.nativeNodes,
      navigation: context.source.navigation, records: finalRecords, borrowedElementReads }) });
  if (statementCompletions.kind === "rejected") return rejectedTargetStage(statementCompletions.diagnostics);
  for (const occurrence of callableValues.value.emissionContexts.sourceOccurrences)
    context.records.providerEvaluationPlans.occurrence(occurrence);
  const localStorageAliases = analyzeRustLocalStorageAliases({ ast: context.ast,
    navigation: context.source.navigation, nativeNodes: context.nativeNodes, records });
  const program: Omit<RustAnalysisProgram, "reachability" | "records"> & {
    readonly records: RustAnalysisRecords & SourceLiteralIndex;
  } = {
    sourceOutputIdentities: sourceOutputIdentities.identities,
    physicalEmissionContexts: callableValues.value.emissionContexts,
    errorRegions: completedErrorRegions,
    promiseResults: promiseResults.results,
    promiseBodies: context.promiseBodies.plan,
    lexicalFunctions,
    errorStorageDemands: context.errorStorageDemands,
    localStorageAliases,
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
    callableValues: callableValues.value,
    callableOwnership: context.callableOwnership.seal(),
    sourceLifetimes: context.sourceLifetimes,
    declarationGenericRequirements: declarationGenericRequirements.index,
    ownership: ownership.ownership,
    retainedCallableInputs: retainedCallableInputs.value,
    structuralShapes: context.structuralShapes.completed,
    frozenDataWrites: context.frozenDataWrites.seal(),
    classValues,
    runtimeReferences: runtimeReferences.plan,
    dispatchContexts: dispatchContexts.plan.declarations,
    dispatchContextDemand: dispatchContextDemand.plan,
    binaryDispatchDemand: binaryDispatchDemand.plan,
    foundation: foundation.plan,
    binaryHooks,
    binaryExecution: binaryExecution.value,
    providerErrorCarriers: analyzeRustProviderErrorCarriers(
      context.nativeNodes,
      records,
      binaryHooks,
    ),
    safetyApplications: context.safetyApplications,
    moduleInitialization,
    names: context.names,
    sourcePackageFacades: sourcePackageFacades.plan,
    sourcePackageComponents,
    projectFlowReadSelections,
    sourceModuleConstructions: sourceModuleConstructions.index,
    generatedDeclarationUses: context.generatedDeclarationUses.seal(),
    borrowedElementReads,
    genericCallableErrors: genericCallableErrors.value,
  };
  const emission = finalizeRustNativeEmission(program, context, genericCallableErrors.value, ownershipFlow.flow,
    sourceStage.operationAttempts, callableEntries.value, classContexts, projectGenericMemberships, headerPlacements);
  if (emission.kind === "rejected") return emission;
  context.callableValues.publish();
  const finalFoundation = finalizeRustFoundation(program.foundation, context.records.minimumFoundation());
  if (finalFoundation.diagnostics.length !== 0) return rejectedTargetStage(finalFoundation.diagnostics);
  context.sourceStorage.sealFormalMemberWriteDemands();
  callableEntries.value.seal();
  classContexts.seal();
  context.records.seal(context.requiredRecords);
  return resolvedTargetStage(Object.freeze({
    ...program,
    reachability: emission.value.reachability,
    nativeDeclarations: emission.value.nativeDeclarations,
    records: Object.freeze({ ...createRustProgramRecords(records), literalValue: context.literalValues.literalValue }),
  }));
}


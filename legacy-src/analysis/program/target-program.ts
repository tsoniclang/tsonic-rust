import {
  rejectedTargetStage,
  resolvedTargetStage,
  type TargetDiagnostic,
} from "@tsonic/target-api/artifacts";
import {
  snapshotTargetPlanningSourceNavigation,
  targetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import type { SourceLiteralIndex } from "@tsonic/target-api/source";
import { analyzeRustProgram } from "./analyze.js";
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
import { analyzeRustGenericAdoption, analyzeRustPromiseResults } from "../callables/promise-results.js";
import { createRustModuleInitializationPlan } from "../module-initialization/analyze.js";
import { analyzeRustProviderErrorCarriers } from "./provider-errors.js";
import { analyzeRustDeclarationGenericRequirements } from "../declarations/generic-requirements.js";
import { analyzeRustOwnershipFlow } from "../ownership/flow.js";
import { analyzeRustBindingProjectionEmission } from "../control-flow/binding-emission.js";
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
  analyzeRustSourcePackageFacades,
} from "./source-package-facades.js";
import {
  validateRustGenericSourcePackageComponents,
} from "./source-package-components.js";
import {
  analyzeRustCountedLoopRepresentations,
} from "../control-flow/counted-loop-representations.js";
import { rustJsAsyncExecutor, rustJsEntryOwner } from "../../providers/model/js-dispatch.js";
import { analyzeRustBinaryExecution } from "../project/binary-execution.js";
import { analyzeRustSourceModuleConstructions } from "../source-modules/index.js";
import { analyzeRustFoundation } from "../foundation/plan.js";
import { rustFoundationForCarrier } from "../foundation/requirements.js";
import { maximumRustFoundation } from "../../target-model/foundation/model.js";
import { analyzeRustProjectFlowReadSelections } from "../control-flow/project-flow-read-selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { analyzeRustErrorRegions, completeRustErrorRegionRecords } from "../errors/regions.js";
import type { RustErrorTypeContext } from "../errors/error-types.js";
import { analyzeRustInitializationErrors } from "../errors/initialization.js";

import { rustTargetOperationIsFallible } from "../operations/target-operation.js";
import { analyzeRustErrorTransport } from "./error-transport.js";
import { analyzeRustBorrowedInitializers } from "../storage/borrowed-initializers.js";
import { analyzeRustNativeDeclarationForms } from "../declarations/native-forms.js";
import { analyzeRustSourceOutputIdentities } from "../names/source-output-identities.js";
import { createRustProviderMutableInputPlan } from "../storage/provider-mutable-inputs.js";
import { analyzeRustRetainedCallableInputs } from "../callables/retained-inputs.js";
import { analyzeRustGenericCallableErrors } from "../callables/generic-errors.js";
import { analyzeRustReachability } from "../reachability/plan.js";
import { rustNativeArgumentBorrowsRead } from "../ownership/uses.js";
import { analyzeRustStatementCompletions } from "../control-flow/statement-completion.js";
import { analyzeRustStatementExits } from "../control-flow/statement-exits.js";
import { analyzeRustResourceScopes } from "../control-flow/resource-scopes.js";
import { rustCarrierReferentMutationRequiresMutableBinding } from "../../target-model/types/index.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { analyzeRustLocalBindings } from "../storage/local-bindings.js";
import { analyzeRustFieldProjectionAssignments } from "../storage/field-projection-assignment.js";
import { analyzeRustAssignmentWrites } from "../storage/assignment-writes.js";
import { analyzeRustFieldWrites } from "../storage/field-writes.js";
import { analyzeRustDeclarationEmission } from "../declarations/emission.js";
import { analyzeRustLexicalValues } from "../callables/lexical-values.js";
import { analyzeRustNativeProtocolEmission } from "../callables/native-protocol-emission.js";
import { analyzeRustGenericErrorEmission } from "../callables/generic-error-emission.js";
import { analyzeRustGenericEmission } from "../callables/generic-emission.js";
import { analyzeRustLexicalFunctionEmission } from "../callables/lexical-emission.js";
import { analyzeRustCallableDeclarationEmission } from "../callables/declaration-emission.js";
import { analyzeRustMethodEmission } from "../declarations/classes/methods.js";
import { analyzeRustFrameEmission } from "../callables/frame-emission.js";
import { analyzeRustSuspendedCallableEmission } from "../callables/suspended-emission.js";
import { analyzeRustConstructionEmission } from "../project-types/construction-emission.js";
import { analyzeRustClassEmission } from "../declarations/classes/planning.js";
import { analyzeRustNativeMemberVisibility } from "../names/native-member-names.js";
import { analyzeRustProjectEmission } from "../project-types/emission.js";
import { analyzeRustClassValueEmission } from "../objects/class-value-emission.js";
import { sourceObjectMemberDeclarations } from "@tsonic/target-api/source";
import { analyzeRustClassInitialization } from "../project-types/class-initialization.js";
import { analyzeRustCallableParameterEmission } from "../callables/parameters.js";
import { analyzeRustDeclarationLiveness } from "../reachability/declaration-emission.js";

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
  if (sourceStage === undefined) throw new Error("Rust program analysis completed without its sealed source-stage output.");
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
  context.records.mutatedReferents.finalizeBindings(declaration => {
    const carrier = context.records.runtimeCarrier.get(declaration)?.carrier;
    if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "A mutated referent requires its finalized declaration carrier.", declaration);
    return rustCarrierReferentMutationRequiresMutableBinding(carrier, selected => {
      const representation = objectRepresentations.representationFor(context.projectTypes.definitionForCarrier(selected));
      return representation !== undefined && (representation.kind !== "value" || !representation.mutable);
    });
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
        rustTargetOperationIsFallible(records.targetOperation.get(node), context.structuralShapes,
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
  const ownershipFlow = analyzeRustOwnershipFlow({
    source: context.source,
    storage: context.sourceStorage,
    nativeNodes: context.nativeNodes,
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
  const errorTypes = { ast: context.ast, records, producers: context.callableValues.nativeProducers,
    definitions: context.typeDefinitions, components: sourcePackageComponents } satisfies RustErrorTypeContext;
  const errorRegions = analyzeRustErrorRegions({ ...errorTypes, sourceFiles: context.sourceFiles,
    isNativeNode: context.isNativeNode,
    promiseBodies: context.promiseBodies.plan,
    names: context.names, callables: context.callableValues.selected });
  if (errorRegions.kind === "rejected") return errorRegions;
  context.callableValues.finalizeStructuralStorage(errorRegions.value);
  const declarationGenericRequirements = analyzeRustDeclarationGenericRequirements(
    context.source,
    context.nativeNodes,
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
    context.promiseBodies.plan,
    context.callableValues.nativeStorage,
    classValues,
    errorTypes,
  );
  const retentionIssues = declarationGenericRequirements.kind === "rejected" ? []
    : context.callableValues.validateStructuralRetention(declarationGenericRequirements.index, context.typeFamilies, classValues, errorTypes);
  const promiseResults = analyzeRustPromiseResults({ ast: context.ast, source: context.source, genericAdoption,
    storage: context.sourceStorage,
    nodes: context.nativeNodes, records, uses: context.promiseResultUses, definitions: context.typeDefinitions,
    nativeStorage: context.callableValues.nativeStorage, native: context.callableValues.native,
    nativeCaptures: context.callableValues.selected.nativeCaptures, errorTypes,
    sourceTypes: sourceStage.sourceTypes,
    sourceLifetimes: context.sourceLifetimes, requirements: declarationGenericRequirements, retentionIssues, families: context.typeFamilies,
    evidence: { genericCallables: context.callableValues.generic, frameCallables: context.callableValues.selected.frames,
      classValues, objectRepresentations, structuralShapes: context.structuralShapes, projectTypes: context.projectTypes, records } });
  if (declarationGenericRequirements.kind === "rejected" || retentionIssues.length !== 0 || promiseResults.diagnostics.length > 0) {
    return rejectedTargetStage([...(declarationGenericRequirements.kind === "rejected" ? declarationGenericRequirements.diagnostics : []),
      ...retentionIssues.map(issue => ({ code: "RUST_CALLABLE_VALUE_NOT_CLOSED", category: "error" as const,
        source: "tsonic-rust", message: issue.message, sourceNode: issue.subject,
        evidence: ["target.capability=rust.callable-value.exact-implementation"] })),
      ...promiseResults.diagnostics]);
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
  const borrowedElementReads = analyzeRustBorrowedElementReads(context.ast, context.nativeNodes, records, context.source.navigation);
  context.records.borrowedElements.publish(context.nativeNodes, borrowedElementReads);
  const borrowEffectsInput = {
    isNativeNode: context.isNativeNode,
    sourceFacts: context.source.sourceFacts,
    ast: context.ast, nodes: context.nativeNodes, records, navigation: context.source.navigation,
    projectTypes: context.projectTypes, objectRepresentations, frozenDataWrites: context.frozenDataWrites,
    structuralShapes: context.structuralShapes,
  };
  const borrowEffects = analyzeRustBorrowEffects(borrowEffectsInput);
  if (borrowEffects.kind === "rejected") return rejectedTargetStage(borrowEffects.diagnostics);
  const ownership = analyzeRustReadOwnership({ storage: context.sourceStorage, nativeNodes: context.nativeNodes, records,
    flow: ownershipFlow.flow, borrowEffects: borrowEffects.effects, borrowEffectsInput, definitions: context.typeDefinitions,
    genericRequirements: declarationGenericRequirements.index, genericCallables: context.callableValues.generic,
    capturesFor, invocationTransfersCapture: owner => {
      const selected = lexicalFunctions.forDeclaration(owner);
      return selected?.kind !== "resolved" || !selected.valueObserved && selected.singleInvocation;
    } });
  if (ownership.kind === "rejected") return rejectedTargetStage(ownership.diagnostics);
  analyzeRustBorrowedInitializers(context.ast, context.nativeNodes, records, ownership.ownership.reads, context.records.borrowedInitializers);
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
    binaryHooks, outputType: configuration.outputType, projectRoot: input.paths.projectRoot,
    entryPoint: input.project.entryPoint });
  if (initializationErrors.kind === "rejected") return initializationErrors;
  const binaryExecution = analyzeRustBinaryExecution({ hooks: binaryHooks, outputType: configuration.outputType,
    jsEnabled, asynchronous: initializationErrors.value.root.asynchronous ||
      initializationErrors.value.workers.some(worker => worker.initializer.asynchronous) });
  if (binaryExecution.kind === "rejected") return binaryExecution;
  analyzeRustStatementExits({ ast: context.ast, nodes: context.nativeNodes, records,
    producer: context.records.statementExits, required: context.requiredRecords });
  analyzeRustResourceScopes({ ast: context.ast, nodes: context.nativeNodes, records,
    producer: context.records.resourceScopes, required: context.requiredRecords });
  const finalRecords = Object.freeze({ ...records, literalValue: context.literalValues.literalValue });
  const completedErrorRegions = completeRustErrorRegionRecords(errorRegions.value, initializationErrors.value);
  const projectFlowReadSelections = analyzeRustProjectFlowReadSelections({ ast: context.ast, sourceFiles: context.sourceFiles,
    isNativeNode: context.isNativeNode, records });
  const statementCompletions = analyzeRustStatementCompletions({ source: context.source, sourceFiles: context.sourceFiles,
    isNativeNode: context.isNativeNode,
    records, names: context.names, typeDefinitions, errorRegions: completedErrorRegions, projectFlowReadSelections,
    producer: context.records.statementCompletions, required: context.requiredRecords,
    safetyApplications: context.safetyApplications,
    components: sourcePackageComponents,
    ownership: ownership.ownership, projectTypes,
    countedLoops: analyzeRustCountedLoopRepresentations({ ast: context.ast, nativeNodes: context.nativeNodes,
      navigation: context.source.navigation, records: finalRecords, borrowedElementReads }) });
  if (statementCompletions.kind === "rejected") return rejectedTargetStage(statementCompletions.diagnostics);
  const providerMutableInputs = createRustProviderMutableInputPlan({ ast: context.ast, records,
    navigation: context.source.navigation, nodes: context.nativeNodes, statementCompletions: statementCompletions.plan });
  const mutableInputDiagnostics: TargetDiagnostic[] = [];
  for (const node of context.nativeNodes) {
    const selection = providerMutableInputs.forOperation(node);
    if (selection?.kind === "rejected") mutableInputDiagnostics.push({ code: "RUST_PROVIDER_MUTABLE_INPUT_NOT_DISJOINT",
      category: "error", source: "tsonic-rust", message: selection.reason,
      sourceNode: selection.node,
      evidence: ["target.capability=rust.native-provider.disjoint-mutable-storage"] });
  }
  if (mutableInputDiagnostics.length > 0) return rejectedTargetStage(mutableInputDiagnostics);
  const callableValues = context.callableValues.seal({
    nativeGenerics: context.records.nativeGenericPlans,
    declarationGenericRequirements: declarationGenericRequirements.index, genericErrors: genericCallableErrors.value,
    retainedCallableInputs: retainedCallableInputs.value,
    errorRegions: completedErrorRegions, initialization: initializationErrors.value,
    constructions: context.projectTypes.definitions.flatMap(definition => {
      const plan = projectConstructions.forDefinition(definition);
      return plan === undefined ? [] : [plan];
    }) });
  if (callableValues.kind === "rejected") return callableValues;
  const localStorageAliases = analyzeRustLocalStorageAliases({ ast: context.ast,
    navigation: context.source.navigation, nativeNodes: context.nativeNodes, records });
  const localBindingIssues = analyzeRustLocalBindings({ ast: context.ast, nodes: context.nativeNodes, records,
    navigation: context.source.navigation, names: context.names, aliases: localStorageAliases,
    representations: objectRepresentations, projectTypes, nativeStorage: callableValues.value.nativeStorage,
    lexicalFunctions, producer: context.records.localBindings, required: context.requiredRecords });
  if (localBindingIssues.length !== 0) return rejectedTargetStage(localBindingIssues);
  const program: Omit<RustTargetProgram, "reachability" | "records"> & {
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
    providerMutableInputs,
    retainedCallableInputs: retainedCallableInputs.value,
    structuralShapes: context.structuralShapes.seal(),
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
  };
  analyzeRustFieldProjectionAssignments({ ast: context.ast, nodes: context.nativeNodes, records,
    navigation: context.source.navigation, projectTypes, representations: objectRepresentations,
    dispatch: program.projectFieldDispatch, producer: context.records.fieldProjectionAssignments, required: context.requiredRecords });
  const assignmentWriteIssues = analyzeRustAssignmentWrites({ program, nodes: context.nativeNodes,
    producer: context.records.assignmentWrites, required: context.requiredRecords });
  if (assignmentWriteIssues.length !== 0) return rejectedTargetStage(assignmentWriteIssues);
  analyzeRustFieldWrites({ program, nodes: context.nativeNodes, producer: context.records.fieldWrites, required: context.requiredRecords });
  analyzeRustDeclarationEmission({ program, nodes: context.nativeNodes, producer: context.records.declarationEmission, required: context.requiredRecords });
  analyzeRustLexicalValues({ program, nodes: context.nativeNodes, producer: context.records.lexicalValuePlans });
  analyzeRustLexicalFunctionEmission({ program, nodes: context.nativeNodes, producer: context.records.lexicalFunctionPlans });
  analyzeRustCallableParameterEmission({ program, nodes: context.nativeNodes, producer: context.records.callableParameterPlans, required: context.requiredRecords });
  const classInitializationIssues = analyzeRustClassInitialization({ program, nodes: context.nativeNodes, producer: context.records.classInitializationPlans });
  if (classInitializationIssues.length !== 0) return rejectedTargetStage(classInitializationIssues);
  const nativeProtocolIssues = analyzeRustNativeProtocolEmission({ program, sourceFiles: context.sourceFiles, producer: context.records.nativeProtocolPlans });
  if (nativeProtocolIssues.length !== 0) return rejectedTargetStage(nativeProtocolIssues);
  analyzeRustGenericErrorEmission({ ast: context.ast, sourceFiles: context.sourceFiles, nodes: context.nativeNodes,
    regions: program.errorRegions, index: genericCallableErrors.value, physical: program.callableValues.generic.physical,
    producer: context.records.errorEmissionPlans });
  analyzeRustGenericEmission({ program, sourceFiles: context.sourceFiles, producer: context.records.genericEmissionPlans });
  const nativeDeclarations = analyzeRustNativeDeclarationForms({ ast: context.ast, sourceFiles: context.sourceFiles,
    semanticsFor: context.semanticsFor,
    names: context.names, records, projectTypes, typeDefinitions, sourceLifetimes: context.sourceLifetimes,
    objectRepresentations, typeFamilies: program.typeFamilies,
    genericRequirements: declarationGenericRequirements.index, structuralShapes: program.structuralShapes });
  if (nativeDeclarations.kind === "rejected") return rejectedTargetStage(nativeDeclarations.diagnostics);
  context.records.nativeDeclarations.publish(context.ast, context.nativeNodes, context.sourceFiles, nativeDeclarations.forms);
  const reachability = analyzeRustReachability(program, context.nativeNodes);
  analyzeRustProjectEmission({ program, nodes: context.nativeNodes, producer: context.records.projectEmissionPlans });
  const callableDeclarationIssues = analyzeRustCallableDeclarationEmission({ program, reachability, nodes: context.nativeNodes,
    producer: context.records.callableDeclarationPlans });
  if (callableDeclarationIssues.length !== 0) return rejectedTargetStage(callableDeclarationIssues);
  const bindingEmissionIssues = analyzeRustBindingProjectionEmission({ program, nodes: context.nativeNodes, producer: context.records.bindingEmission });
  if (bindingEmissionIssues.length !== 0) return rejectedTargetStage(bindingEmissionIssues);
  const methodEmissionIssues = analyzeRustMethodEmission({ program, nodes: context.nativeNodes, producer: context.records.methodEmissionPlans });
  if (methodEmissionIssues.length !== 0) return rejectedTargetStage(methodEmissionIssues);
  analyzeRustFrameEmission({ program, sourceFiles: context.sourceFiles, producer: context.records.frameEmissionPlans });
  analyzeRustSuspendedCallableEmission({ program, sourceFiles: context.sourceFiles, producer: context.records.suspendedCallablePlans });
  const constructionEmissionIssues = analyzeRustConstructionEmission({ program, producer: context.records.constructionPlans });
  if (constructionEmissionIssues.length !== 0) return rejectedTargetStage(constructionEmissionIssues);
  const classEmissionIssues = analyzeRustClassEmission({ program, reachability, producer: context.records.classEmissionPlans });
  if (classEmissionIssues.length !== 0) return rejectedTargetStage(classEmissionIssues);
  analyzeRustClassValueEmission({ program, nodes: context.nativeNodes, producer: context.records.classEmissionPlans });
  analyzeRustNativeMemberVisibility(program.source.ast, program.projectTypes.definitions.flatMap(definition =>
    sourceObjectMemberDeclarations(program.source.ast, definition.declaration).filter((member): member is Node => member !== undefined)), context.records.classEmissionPlans);
  analyzeRustDeclarationLiveness({ program, reachability, nodes: context.nativeNodes,
    producer: context.records.nativeLiveness, required: context.requiredRecords });
  context.callableValues.publish();
  context.records.seal(context.requiredRecords);
  return resolvedTargetStage(Object.freeze({ ...program,
    records: Object.freeze({ ...createRustProgramRecords(records), literalValue: context.literalValues.literalValue }),
    reachability }));
}

export type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";

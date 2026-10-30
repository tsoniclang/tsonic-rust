import { createRustIntegerRangeIndex } from "./records/operations/integer-ranges.js";
import { createTsonicMemoryBindingIndex, createTsonicMemoryMetadataIndex, type TsonicMemoryMetadataIndex, createTsonicPointerBackingDemands, type TsonicPointerBackingDemands, createTsonicPointerReturnQueries } from "@tsonic/source-core/facts";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput, TargetSelection } from "@tsonic/target-api";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import { analyzeSourceLiteralValues, createSourceCallableInvocationReferenceQuery } from "@tsonic/target-api/source";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../target-model/types/index.js";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustSourcePolicyContext } from "../../policy/model/context.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import type { RustProviderSemantics } from "../../target-model/metadata/provider-metadata.js";
import { createRustNamePlan } from "../names/plan.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import { createRustSourceTypeFamilyRegistry } from "../project-types/type-families.js";
import { createRustTypeDefinitionRegistry, type RustTypeDefinitionRegistry } from "../project-types/type-definitions.js";
import { createRustClassValueRegistry, type RustClassValueRegistry } from "./records/objects/class-value-registry.js";
import { createRustProgramRecordBuilder } from "./records/create.js";
import type { RustRequiredRecord } from "./records/objects/required-records.js";
import type { RustProgramRecordBuilder } from "./records/model.js";
import { createRustProjectTypePolicyRegistry } from "../project-types/index.js";
import type { RustProjectTypePolicyRegistry } from "../project-types/index.js";
import { createRustProjectMethodDispatchPlanRegistry } from "../project-types/method-dispatch.js";
import type { RustProjectMethodDispatchPlanRegistry } from "../project-types/method-dispatch.js";
import { createRustProjectMethodPropertyPlanRegistry } from "../project-types/method-properties.js";
import type { RustProjectMethodPropertyPlanRegistry } from "../project-types/method-properties.js";
import { createRustProjectFieldDispatchPlanRegistry } from "../project-types/field-dispatch.js";
import type { RustProjectFieldDispatchPlanRegistry } from "../project-types/field-dispatch.js";
import { createRustSourceCallableSpecializationPlanRegistry } from "../callables/generics/specializations.js";
import type { RustSourceCallableSpecializationPlanRegistry } from "../callables/generics/specializations.js";
import { createRustCallableValuePlanRegistry, type RustCallableValuePlanRegistry } from "../callables/values/value-plan.js";
import { createRustStructuralShapePlanRegistry } from "../objects/shapes/structural-shape-registry.js";
import type { RustStructuralShapePlanRegistry } from "../objects/shapes/structural-shape-registry.js";
import { createRustFrozenDataWriteRegistry, type RustFrozenDataWriteRegistry } from "../objects/frozen-data-writes.js";
import { createRustSafetyApplicationFactIndex } from "../safety/application-index.js";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import { createRustObjectRepresentationPlanRegistry, type RustObjectRepresentationPlanRegistry } from "../project-types/object-representation.js";
import { createRustRuntimeValueUsePlan, type RustRuntimeValueUsePlan } from "./runtime-value-uses.js";
import { analyzeRustLifetimes } from "../declarations/lifetimes.js";
import { emptyRustLifetimeIndex, type RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import { createRustGeneratedDeclarationUseRegistry, type RustGeneratedDeclarationUseRegistry } from "./records/program/generated-declaration-uses.js";
import { createRustErrorStorageDemandQuery } from "../objects/error-storage-demands.js";
import { analyzeSourceReceiverOccurrences, createSourceStorageQuery, type SourceErrorStorageDemandQueries, type SourceStorageQueries, type SourceNativeTaskGraph } from "@tsonic/target-api/analysis";
import { createRustRetainedErrorDemandSelection } from "../objects/retained-error-demands.js";
import { createRustSourceProfileRegistry } from "../project/source-profiles.js";
import { createRustSourceProfileStorageEffects } from "../operations/source-profiles/source-storage-effects.js";
import { createRustCallableOwnershipRegistry, type RustCallableOwnershipRegistry } from "../callables/ownership/ownership-plan.js";
import { createRustSourceCallableQueries } from "../callables/ownership/borrowed-returns.js";
import { createRustExplicitUnsafeContexts } from "../safety/explicit-regions.js";
import { createRustRetainedEnvironmentQueries } from "../callables/ownership/retained-environment-shapes.js";
import { analyzeRustNumericLiteralAdmission } from "../numeric/literal-admission.js";
import { analyzeRustPromiseResultUses } from "../callables/async/promise-results.js";
import type { RustPromiseResultUses } from "../../target-model/records/callables/promise-results.js";
import { createRustPromiseBodySelection, type RustPromiseBodySelection } from "../callables/async/promise-bodies.js";
import { analyzeRustNativeParticipation } from "../callables/calls/participation.js";
import { selectRustSourcePackageComponentIdentities, type SelectRustSourcePackageComponentIdentitiesResult } from "../source-modules/component-semantics.js";
import { collectRustSourcePackageBoundaries } from "../source-modules/boundaries.js";
import { selectRustNativeModuleCallables, type RustNativeModuleCallables } from "./module-bindings.js";
import { analyzeRustNativeTaskGraph } from "../callables/native/native-tasks.js";

export interface RustAnalysisContext extends RustSourcePolicyContext {
  readonly sourceProfiles: import("../../policy/types/model/source-profile.js").RustSourceProfileRegistry;
  readonly sourceStorage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly promiseResultUses: RustPromiseResultUses;
  readonly promiseBodies: RustPromiseBodySelection;
  readonly nativeTaskGraph: SourceNativeTaskGraph;
  readonly callableInvocationReferences: ReturnType<typeof createSourceCallableInvocationReferenceQuery>;
  readonly moduleCallables: RustNativeModuleCallables;
  readonly sourceBoundaries: ReturnType<typeof collectRustSourcePackageBoundaries>;
  readonly receiverOccurrences: ReadonlyMap<Node, readonly Node[]> | undefined;
  readonly callableOwnership: RustCallableOwnershipRegistry;
  readonly errorStorageDemands: SourceErrorStorageDemandQueries;
  readonly typeDefinitions: RustTypeDefinitionRegistry;
  readonly typeFamilies: RustSourceTypeFamilyRegistry;
  readonly pointerBacking: TsonicPointerBackingDemands;
  readonly memoryMetadata: TsonicMemoryMetadataIndex;
  readonly target: TargetSelection;
  readonly jsEnabled: boolean;
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourcePackages: TargetCompileInput["sourcePackages"];
  readonly sourcePackageComponentIdentities: SelectRustSourcePackageComponentIdentitiesResult;
  readonly rootPublishesLibrary: boolean;
  readonly records: RustProgramRecordBuilder;
  readonly requiredRecords: RustRequiredRecord[];
  readonly projectTypes: RustProjectTypePolicyRegistry;
  readonly objectRepresentations: RustObjectRepresentationPlanRegistry;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlanRegistry;
  readonly projectMethodProperties: RustProjectMethodPropertyPlanRegistry;
  readonly projectFieldDispatch: RustProjectFieldDispatchPlanRegistry;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlanRegistry;
  readonly callableValues: RustCallableValuePlanRegistry;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly structuralShapes: RustStructuralShapePlanRegistry;
  readonly frozenDataWrites: RustFrozenDataWriteRegistry;
  readonly classValues: RustClassValueRegistry;
  readonly providerSemantics: RustProviderSemantics;
  readonly dispatchContexts: import("../project/dispatch-contexts.js").RustDispatchContextCatalog;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly runtimeValueUses: RustRuntimeValueUsePlan;
  readonly generatedDeclarationUses: RustGeneratedDeclarationUseRegistry;
  readonly names: RustNamePlan;
  readonly diagnostics: TargetDiagnostic[];
  semantics(sourceFile: SourceFile): SourceFileSemantics;
  semanticsFor(node: Node): SourceFileSemantics;
}

export function createRustAnalysisContext(
  input: TargetCompileInput,
  providerSemantics: RustProviderSemantics,
  jsEnabled: boolean,
  rootPublishesLibrary: boolean,
  dispatchContexts: import("../project/dispatch-contexts.js").RustDispatchContextCatalog,
): TargetStageResult<RustAnalysisContext> {
  const ast = input.source.ast;
  const rawSourceFiles: readonly (SourceFile | undefined)[] = input.source.sourceFiles;
  const sourceFiles = Object.freeze(
    isDenseDataArray(rawSourceFiles) && rawSourceFiles.every((sourceFile) => sourceFile !== undefined)
      ? rawSourceFiles.filter((sourceFile): sourceFile is SourceFile =>
          sourceFile !== undefined && !ast.isDeclarationFile(sourceFile))
      : [],
  );
  const literalValues = analyzeSourceLiteralValues(ast, sourceFiles);
  const sourcePackageComponentIdentities = selectRustSourcePackageComponentIdentities(input.sourcePackages, ast, sourceFiles);
  if (sourcePackageComponentIdentities.kind === "rejected") return rejectedTargetStage(sourcePackageComponentIdentities.diagnostics);
  const safetyApplications = createRustSafetyApplicationFactIndex({
    ast,
    sourceFiles,
    sourceFacts: input.source.sourceFacts,
    navigation: input.source.navigation,
  });
  const runtimeValueUses = createRustRuntimeValueUsePlan({
    ast,
    navigation: input.source.navigation,
    safetyApplications,
  });
  const sourceProfiles = createRustSourceProfileRegistry(input.source, jsEnabled);
  const sourceStorage = createSourceStorageQuery(input.source, sourceFiles, undefined,
    createRustSourceProfileStorageEffects(input.source, sourceProfiles));
  const sourceStorageFailure = sourceStorage.failureReason();
  if (sourceStorageFailure !== undefined) return rejectedTargetStage([{
    code: "RUST_SOURCE_STORAGE_NOT_PROVEN", category: "error", source: "tsonic-rust", message: sourceStorageFailure,
  }]);
  const typeDefinitions = createRustTypeDefinitionRegistry(jsEnabled ? rustJsValueTargetType() : rustTsValueTargetType());
  const records = createRustProgramRecordBuilder(typeDefinitions);
  const requiredRecords: RustRequiredRecord[] = [];
  const participation = analyzeRustNativeParticipation({ ast, storage: sourceStorage, navigation: input.source.navigation,
    producer: records.nativeParticipations, requiredRecords });
  if (participation.kind === "unresolved") return rejectedTargetStage([{
    code: "RUST_NATIVE_PARTICIPATION_NOT_CLOSED", category: "error", source: "tsonic-rust", message: participation.reason,
    evidence: ["target.capability=rust.native-participation"],
  }]);
  const nativeNodes = participation.nodes;
  const nativeNodeSet = new Set(nativeNodes);
  const isNativeNode = (node: Node): boolean => nativeNodeSet.has(node);
  const numericLiteralAdmission = analyzeRustNumericLiteralAdmission(ast, sourceFiles, literalValues, isNativeNode);
  const promiseResultUses = analyzeRustPromiseResultUses(ast, sourceStorage.nodes);
  const receiverOccurrences = analyzeSourceReceiverOccurrences(input.source, sourceFiles);
  const names = createRustNamePlan({
    ast,
    semanticsFor: input.source.semantics.forNode,
    runtimeValueUses,
    sourceFiles,
    isNativeNode,
  });
  const sourceCallables = createRustSourceCallableQueries(sourceStorage,
    createRustExplicitUnsafeContexts(ast, sourceFiles, node => safetyApplications.operationForExpression(node)),
    runtimeValueUses.promiseCallAliasTarget);
  const sourceBoundaries = collectRustSourcePackageBoundaries({ ast, source: input.source,
    sourcePackages: input.sourcePackages, rootPublishesLibrary }, sourceFiles,
    sourcePackageComponentIdentities.identities.rootComponentId);
  const moduleCallables = selectRustNativeModuleCallables({ ast, source: input.source, sourceFiles, names, runtimeValueUses });
  if (moduleCallables.kind === "rejected") return moduleCallables;
  const callableInvocationReferences = createSourceCallableInvocationReferenceQuery({ ast, navigation: input.source.navigation,
    nativeCallableFor: declaration => moduleCallables.value.nativeCallable(declaration)?.callableDeclaration,
    lexicalBindingFor: sourceCallables.directLexicalBinding, callAliasFor: sourceCallables.promiseCallAliasTarget });
  const nativeTaskGraph = analyzeRustNativeTaskGraph({ context: { ast, source: input.source, sourceStorage,
    nativeNodes, isNativeNode, promiseResultUses, sourceProfiles, providerSemantics, jsEnabled, runtimeValueUses,
    sourceCallables, moduleCallables: moduleCallables.value, callableInvocationReferences }, publishedDeclarations: sourceBoundaries.publishedDeclarations,
    lifecycleOwner: sourceFiles.find(file => sourcePackageComponentIdentities.identities.componentIdForFile(ast.getFileName(file)) ===
      sourcePackageComponentIdentities.identities.rootComponentId) });
  if (nativeTaskGraph.kind === "rejected") return nativeTaskGraph;
  records.sourceNamePlans.publish(nativeNodes, names);
  const lifetimes = analyzeRustLifetimes({
    source: input.source,
    ast,
    sourceFiles,
    records,
    names,
    isNativeNode,
    referencedDeclaration(node) {
      return input.source.navigation.sourceReferenceFor(node)?.declaration;
    },
    semanticsFor: input.source.semantics.forNode,
  });
  const memoryBindings = createTsonicMemoryBindingIndex(input.source);
  return resolvedTargetStage<RustAnalysisContext>(Object.freeze({
    callableRepresentation: "storage" as const,
    literalValues,
    integerRanges: createRustIntegerRangeIndex(input.source, sourceStorage.nodes),
    sourceProfiles,
    sourceStorage,
    nativeNodes,
    isNativeNode,
    receiverOccurrences: receiverOccurrences.kind === "resolved" ? receiverOccurrences.occurrences : undefined,
    sourceCallables,
    sourceBoundaries,
    moduleCallables: moduleCallables.value,
    callableInvocationReferences,
    nativeTaskGraph: nativeTaskGraph.value,
    retainedEnvironments: createRustRetainedEnvironmentQueries({ source: input.source, sourceStorage,
      sourceLifetimes: lifetimes.index ?? emptyRustLifetimeIndex, nativeTasks: nativeTaskGraph.value }),
    callableOwnership: createRustCallableOwnershipRegistry(),
    errorStorageDemands: createRustErrorStorageDemandQuery(input.source,
      sourceProfiles, sourceStorage,
      createRustRetainedErrorDemandSelection(input.source, providerSemantics.operations)),
    typeDefinitions,
    typeFamilies: createRustSourceTypeFamilyRegistry(),
    pointerBacking: createTsonicPointerBackingDemands(input.source),
    pointerReturns: createTsonicPointerReturnQueries(input.source),
    memoryMetadata: createTsonicMemoryMetadataIndex(input.source),
    memoryBindings,
    source: input.source,
    target: input.target,
    jsEnabled,
    ast,
    sourceFiles,
    sourcePackages: input.sourcePackages,
    sourcePackageComponentIdentities,
    promiseResultUses,
    promiseBodies: createRustPromiseBodySelection(),
    rootPublishesLibrary,
    records,
    requiredRecords,
    projectTypes: createRustProjectTypePolicyRegistry(),
    objectRepresentations: createRustObjectRepresentationPlanRegistry(),
    projectMethodDispatch: createRustProjectMethodDispatchPlanRegistry(),
    projectMethodProperties: createRustProjectMethodPropertyPlanRegistry(),
    projectFieldDispatch: createRustProjectFieldDispatchPlanRegistry(),
    sourceCallableSpecializations: createRustSourceCallableSpecializationPlanRegistry(),
    callableValues: createRustCallableValuePlanRegistry(),
    sourceLifetimes: lifetimes.index ?? emptyRustLifetimeIndex,
    structuralShapes: createRustStructuralShapePlanRegistry(),
    frozenDataWrites: createRustFrozenDataWriteRegistry(),
    classValues: createRustClassValueRegistry(),
    providerSemantics,
    dispatchContexts,
    safetyApplications,
    runtimeValueUses,
    generatedDeclarationUses: createRustGeneratedDeclarationUseRegistry(),
    names,
    diagnostics: [...numericLiteralAdmission, ...names.diagnostics, ...lifetimes.diagnostics,
      ...(receiverOccurrences.kind === "unresolved" ? [{ code: "RUST_RECEIVER_OCCURRENCES_UNRESOLVED",
        category: "error" as const, source: "tsonic-rust", message: receiverOccurrences.reason,
        evidence: ["target.capability=rust.analysis.ownership"] }] : []),
      ...memoryBindings.issues.map(issue => ({
      code: "RUST_MEMORY_BINDING_NOT_PROVEN", category: "error" as const, source: "tsonic-rust",
      sourceNode: issue.node, message: issue.reason,
    }))],
    semantics: input.source.semantics.forFile,
    semanticsFor: input.source.semantics.forNode,
  }));
}

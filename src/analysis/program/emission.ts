import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";

import type { SourceLiteralIndex } from "@tsonic/target-api/source";

import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";

import type { RustAnalysisProgram } from "./model.js";
import type { RustCallableEntryConstruction } from "../callables/emission/entry-parameters.js";
import type { createRustCallableEntryHeaderPlacements } from "../callables/emission/entry-header-placements.js";
import type { RustClassImplementationContextConstruction } from "../objects/class-implementation-contexts.js";

import { analyzeRustLocationStorage } from "../storage/location-storage.js";

import { analyzeRustBindingProjectionEmission } from "../control-flow/binding-emission.js";

import { analyzeRustSourcePackageFacadeEmission } from "../source-modules/package-facades.js";
import { analyzeRustSourcePackageComponentEmission } from "../source-modules/package-components.js";
import { analyzeRustSourcePackageInitializers } from "../source-modules/package-initializers.js";
import { analyzeRustSourcePackageErrors, analyzeRustSourcePackageErrorBoundaries } from "../errors/source-packages.js";
import { analyzeRustDeclarationErrorOwners } from "../errors/declaration-owners.js";
import { analyzeRustSourceErrorRegions } from "../errors/source-regions.js";
import { analyzeRustSourceBindingEmission } from "../storage/binding-paths.js";
import { analyzeRustSourceFileEmission } from "../source-modules/emission.js";
import { analyzeRustWorkerEntries } from "../source-modules/worker-entries.js";
import { analyzeRustProgramEmission } from "../source-modules/program-emission.js";
import { analyzeRustSourceArtifacts } from "../source-modules/artifacts.js";
import { analyzeRustSafetyEmission } from "../safety/emission.js";
import { analyzeRustArrayLiterals } from "../operations/array-literals.js";
import { analyzeRustPropertyValueProjection } from "../conversions/property-value-projection.js";
import { analyzeRustOptionalChainEmission } from "../operations/optional-chains.js";
import { analyzeRustValueReads } from "../conversions/value-reads.js";
import { analyzeRustLiteralEmission } from "../operations/literals.js";
import { analyzeRustTemplateStrings } from "../operations/template-strings.js";
import { analyzeRustNativeComparisons } from "../operations/native-comparisons.js";
import { analyzeRustNativeMemoryEmission } from "../operations/native-memory-emission.js";
import { admitRustUnionProjections } from "../operations/union-projections.js";
import { analyzeRustUnionEquality } from "../operations/union-equality.js";
import { analyzeRustOptionEquality } from "../operations/option-equality.js";
import { analyzeRustIndexedLocations } from "../storage/indexed-locations.js";
import { admitRustComputedMembers } from "../operations/computed-members.js";
import { analyzeRustLocationCallbacks } from "../callables/native/location-callbacks.js";
import { analyzeRustErasedInputArguments } from "../callables/calls/erased-input-arguments.js";
import { analyzeRustDirectStorage } from "../storage/direct-storage.js";
import { analyzeRustUnaryEmission } from "../operations/expression-unary.js";
import { analyzeRustFlowReadEmission } from "../control-flow/flow-read-emission.js";
import { analyzeRustProjectUnionMappings } from "../conversions/project-union-mappings.js";
import { analyzeRustReceiverCaptureEmission } from "../storage/receiver-captures.js";
import { analyzeRustErrorFieldBorrows } from "../operations/error-field-borrows.js";
import { analyzeRustStringComparisonViews } from "../operations/strings/string-comparison-views.js";
import { analyzeRustClosedTypeTests } from "../operations/type-test-emission.js";
import { analyzeRustSourceAssertions } from "../conversions/source-assertions.js";
import { analyzeRustPackageCargo } from "../source-modules/package-cargo.js";
import { analyzeRustSignatureVisibility } from "../reachability/signature-visibility.js";
import { analyzeRustErrorVariantEmission } from "../errors/transport-emission.js";
import { analyzeRustClosedErrorValues } from "../errors/closed-values.js";
import { analyzeRustProgramErrorModuleEmission } from "../errors/module-emission.js";
import { analyzeRustDispatchRootEmission } from "../project/dispatch-emission.js";
import { analyzeRustBinaryDispatchEmission } from "../project/binary-dispatch-emission.js";
import { analyzeRustStructuralLivenessEmission } from "../reachability/structural-emission.js";

import { analyzeRustNativeDeclarationForms } from "../declarations/native-forms.js";

import { analyzeRustReachability } from "../reachability/plan.js";

import { analyzeRustFieldProjectionAssignments } from "../storage/field-projection-assignment.js";
import { analyzeRustAssignmentWrites } from "../storage/assignment-writes.js";
import { analyzeRustFieldWrites } from "../storage/field-writes.js";
import { analyzeRustDeclarationEmission } from "../declarations/emission.js";
import { analyzeRustLexicalValues } from "../callables/values/lexical-values.js";
import { analyzeRustNativeProtocolEmission } from "../callables/emission/native-protocol-emission.js";
import { analyzeRustGenericErrorEmission } from "../callables/emission/generic-error-emission.js";
import { analyzeRustGenericEmission } from "../callables/emission/generic-emission.js";
import { analyzeRustSourceCallableEmission } from "../callables/calls/source-callable-value.js";
import { analyzeRustReferenceOperations } from "../operations/reference-operations.js";
import { analyzeRustNullishCoalescing } from "../operations/nullish-coalescing.js";
import { analyzeRustObjectReferenceEmission } from "../objects/object-reference-views.js";
import { analyzeRustSourceCallArguments } from "../callables/calls/source-call-arguments.js";
import { analyzeRustBinaryEmission } from "../operations/binary-emission.js";
import { analyzeRustAssignmentEvaluation } from "../storage/assignment-evaluation.js";
import { analyzeRustCallableDeclarationEmission } from "../callables/emission/declaration-emission.js";
import { analyzeRustMethodEmission } from "../declarations/classes/methods.js";
import { analyzeRustFrameEmission } from "../callables/emission/frame-emission.js";
import { analyzeRustSuspendedCallableEmission } from "../callables/emission/suspended-emission.js";
import { analyzeRustConstructionEmission } from "../project-types/construction-emission.js";
import { analyzeRustClassEmission } from "../declarations/classes/planning.js";
import { analyzeRustNativeMemberVisibility } from "../names/native-member-names.js";
import { analyzeRustProjectEmission } from "../project-types/emission.js";
import { analyzeRustOptionalStorageCallEmission } from "../project-types/optional-storage-emission.js";
import { analyzeRustClassValueEmission } from "../objects/class-value-emission.js";
import { analyzeRustClassImplementations } from "../objects/class-implementations.js";
import { analyzeRustCarrierReads } from "../ownership/carrier-reads.js";
import { analyzeRustProviderMutableEmission } from "../storage/provider-mutable-emission.js";
import { analyzeRustProviderEvaluation } from "../storage/provider-evaluation.js";
import { analyzeRustProviderInputs } from "../operations/provider-inputs.js";
import { analyzeRustLambdaEmission } from "../callables/emission/lambda-emission.js";
import { analyzeRustIntegerTruncation } from "../operations/integer-truncation.js";
import { analyzeRustProviderForms, selectRustProviderReads } from "../operations/provider-forms.js";
import { analyzeRustCallableEmission } from "../conversions/callable-emission.js";
import { analyzeRustRecordFieldStorage } from "../objects/record-field-storage.js";
import { analyzeRustArgumentViews } from "../operations/argument-views.js";
import { admitRustRecordContributions } from "../reachability/record-contributions.js";
import { admitRustErrorObservations } from "../errors/observations.js";
import { analyzeRustUnionCalls } from "../callables/calls/union-calls.js";
import { analyzeRustPropertyReads } from "../operations/property-reads.js";
import { analyzeRustSourceCalls } from "../callables/calls/source-calls.js";
import { admitRustCalls } from "../operations/call-admission.js";
import { analyzeRustExpressionSyntax } from "../operations/expression-syntax.js";
import { analyzeRustCompletionBindings } from "../control-flow/completion-bindings.js";
import { analyzeRustIndexedRecords } from "../objects/indexed-records.js";
import { analyzeRustObjectProjections } from "../objects/projection-emission.js";
import { analyzeRustStructuralEmission } from "../objects/structural-emission.js";
import { analyzeRustStoredFields } from "../storage/stored-fields.js";
import { analyzeRustProjectClassLayouts } from "../project-types/class-layouts.js";
import { analyzeRustObjectLiteralEmission } from "../objects/object-literal-emission.js";
import { analyzeRustProjectMemberErrors } from "../errors/member-emission.js";
import { analyzeRustGenericRequirementEmission } from "../declarations/requirement-emission.js";
import { analyzeRustTypeEmission } from "../source-evidence/types/emission.js";
import { sourceObjectMemberDeclarations } from "@tsonic/target-api/source";
import { analyzeRustClassInitialization } from "../project-types/class-initialization.js";
import { analyzeRustCallableParameterEmission } from "../callables/values/parameters.js";
import { analyzeRustDeclarationLiveness } from "../reachability/declaration-emission.js";

import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustReachability } from "../../target-model/records/program/reachability.js";
import type { RustNativeDeclarationForms } from "../../target-model/records/native/native-declaration-forms.js";

export interface RustNativeEmissionResult {
  readonly reachability: RustReachability;
  readonly nativeDeclarations: RustNativeDeclarationForms;
}
import type { RustAnalysisContext } from "./context.js";
import type { RustGenericCallableErrorIndex } from "../../target-model/records/callables/generic-callable-errors.js";
import type { RustOwnershipFlow } from "../../target-model/records/storage/ownership-flow.js";
import { analyzeRustBindingLiveness } from "../control-flow/binding-liveness.js";
import { analyzeRustLocalBindings } from "../storage/local-bindings.js";
import type { RustOperationAttempt } from "./operation-attempts.js";
import type { prepareRustProjectGenericMembership } from "../project-types/generic-membership.js";

export function finalizeRustNativeEmission(
  program: Omit<RustAnalysisProgram, "reachability" | "records"> & { readonly records: RustAnalysisRecords & SourceLiteralIndex },
  context: RustAnalysisContext, genericCallableErrors: RustGenericCallableErrorIndex,
  flow: RustOwnershipFlow,
  operationAttempts: Pick<WeakMap<Node, RustOperationAttempt>, "get">,
  callableEntries: Pick<RustCallableEntryConstruction, "get" | "selectHeader">,
  classContexts: Pick<RustClassImplementationContextConstruction, "forInstance">,
  projectGenericMemberships: ReturnType<typeof prepareRustProjectGenericMembership>,
  headerPlacements: ReturnType<typeof createRustCallableEntryHeaderPlacements>,
): TargetStageResult<RustNativeEmissionResult> {
  const { projectTypes, objectRepresentations, typeDefinitions } = program;
  const records = context.records.readers;
  analyzeRustFieldProjectionAssignments({ ast: context.ast, nodes: context.nativeNodes, records,
    navigation: context.source.navigation, projectTypes, representations: objectRepresentations,
    dispatch: program.projectFieldDispatch, producer: context.records.fieldProjectionAssignments, required: context.requiredRecords });
  const assignmentWriteIssues = analyzeRustAssignmentWrites({ program, nodes: context.nativeNodes,
    producer: context.records.assignmentWrites, required: context.requiredRecords });
  if (assignmentWriteIssues.length !== 0) return rejectedTargetStage(assignmentWriteIssues);
  analyzeRustFieldWrites({ program, nodes: context.nativeNodes, producer: context.records.fieldWrites, required: context.requiredRecords });
  const declarationEmissionIssues = analyzeRustDeclarationEmission({ program, nodes: context.nativeNodes,
    producer: context.records.declarationEmission, required: context.requiredRecords });
  if (declarationEmissionIssues.length !== 0) return rejectedTargetStage(declarationEmissionIssues);
  analyzeRustLexicalValues({ program, nodes: context.nativeNodes, producer: context.records.lexicalValuePlans });
  analyzeRustCallableParameterEmission({ program, callableEntries, nodes: context.nativeNodes, producer: context.records.callableParameterPlans, required: context.requiredRecords });
  const classInitializationIssues = analyzeRustClassInitialization({ program, nodes: context.nativeNodes, producer: context.records.classInitializationPlans });
  if (classInitializationIssues.length !== 0) return rejectedTargetStage(classInitializationIssues);
  const nativeProtocolIssues = analyzeRustNativeProtocolEmission({ program, sourceFiles: context.sourceFiles, producer: context.records.nativeProtocolPlans });
  if (nativeProtocolIssues.length !== 0) return rejectedTargetStage(nativeProtocolIssues);
  analyzeRustGenericErrorEmission({ ast: context.ast, sourceFiles: context.sourceFiles, nodes: context.nativeNodes,
    regions: program.errorRegions, index: genericCallableErrors, physical: program.callableValues.generic.physical,
    producer: context.records.errorEmissionPlans });
  const sourceCallableEmission = analyzeRustSourceCallableEmission(program, context.nativeNodes, context.records.sourceCallableEmissionPlans);
  if (sourceCallableEmission.issues.length !== 0) return rejectedTargetStage(sourceCallableEmission.issues);
  analyzeRustGenericEmission({ program, callableEntries, source: context.source, sourceFiles: context.sourceFiles, nodes: context.nativeNodes,
    producer: context.records.genericEmissionPlans, sourceValues: sourceCallableEmission.values });
  const nativeDeclarations = analyzeRustNativeDeclarationForms({ ast: context.ast, sourceFiles: context.sourceFiles,
    semanticsFor: context.semanticsFor,
    names: context.names, records, projectTypes, typeDefinitions, sourceLifetimes: context.sourceLifetimes,
    objectRepresentations, typeFamilies: program.typeFamilies,
    genericRequirements: program.declarationGenericRequirements, structuralShapes: program.structuralShapes });
  if (nativeDeclarations.kind === "rejected") return rejectedTargetStage(nativeDeclarations.diagnostics);
  context.records.nativeDeclarations.publish(context.ast, context.nativeNodes, context.sourceFiles, nativeDeclarations.forms);
  const reachability = analyzeRustReachability(program, context.nativeNodes, context.records.conversionEmissionPlans, context.semanticsFor, context.runtimeValueUses);
  const recordContributionIssues = admitRustRecordContributions(program, reachability.recordContributions, context.records.recordContributionPlans);
  if (recordContributionIssues.length !== 0) return rejectedTargetStage(recordContributionIssues);
  const facadeEmission = analyzeRustSourcePackageFacadeEmission(program, program.sourceOutputIdentities);
  if (facadeEmission.plan === undefined) return rejectedTargetStage(facadeEmission.diagnostics);
  context.records.sourcePackageEmission.facades(facadeEmission.plan);
  const componentEmission = analyzeRustSourcePackageComponentEmission(program, program.sourceOutputIdentities, facadeEmission.plan);
  if (componentEmission.kind === "rejected") return rejectedTargetStage(componentEmission.diagnostics);
  if (!componentEmission.components.some(component => component.root)) return rejectedTargetStage([{
    code: "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISSING", category: "error", source: "tsonic-rust",
    message: "Rust artifact planning has no exact root source-package component.",
    evidence: ["target.capability=rust.backend.source-package-components"],
  }]);
  context.records.sourcePackageEmission.components(componentEmission.components);
  const initializerEmission = analyzeRustSourcePackageInitializers(program, componentEmission.components, program.sourceOutputIdentities);
  if (initializerEmission.plan === undefined) return rejectedTargetStage(initializerEmission.diagnostics);
  context.records.sourcePackageEmission.initializers(initializerEmission.plan);
  const errorEmission = analyzeRustSourcePackageErrors(program, componentEmission.components);
  if (errorEmission.plan === undefined) return rejectedTargetStage(errorEmission.diagnostics);
  analyzeRustSourcePackageErrorBoundaries(program, errorEmission.plan, context.records.sourcePackageEmission);
  const workerEntryIssues = analyzeRustWorkerEntries(program, context.records.sourcePackageEmission);
  if (workerEntryIssues.length !== 0) return rejectedTargetStage(workerEntryIssues);
  const errorVariantIssues = analyzeRustErrorVariantEmission(program, errorEmission.plan, context.records.errorTransportEmissionPlans);
  if (errorVariantIssues.length !== 0) return rejectedTargetStage(errorVariantIssues);
  const closedErrorValueIssues = analyzeRustClosedErrorValues(program, errorEmission.plan, context.nativeNodes,
    context.records.errorTransportEmissionPlans, context.records.conversionEmissionPlans);
  if (closedErrorValueIssues.length !== 0) return rejectedTargetStage(closedErrorValueIssues);
  analyzeRustProjectEmission({ program, nodes: context.nativeNodes, producer: context.records.projectEmissionPlans,
    memberships: projectGenericMemberships });
  analyzeRustClassImplementations(program, context.records.classEmissionPlans, classContexts);
  context.structuralShapes.seal();
  analyzeRustOptionalStorageCallEmission(program, context.nativeNodes, context.records.projectEmissionPlans);
  analyzeRustStoredFields(program, context.nativeNodes, context.records.storedFieldPlans);
  const objectReferenceEmission = analyzeRustObjectReferenceEmission(program, context.nativeNodes, context.records.objectReferenceEmissionPlans);
  if (objectReferenceEmission.issues.length !== 0) return rejectedTargetStage(objectReferenceEmission.issues);
  const structuralEmissionIssues = analyzeRustStructuralEmission(program, context.nativeNodes, context.records.structuralEmissionPlans, context.records.projectEmissionPlans);
  if (structuralEmissionIssues.length !== 0) return rejectedTargetStage(structuralEmissionIssues);
  const indexedRecordIssues = analyzeRustIndexedRecords(program, context.nativeNodes, context.records.indexedRecordPlans);
  if (indexedRecordIssues.length !== 0) return rejectedTargetStage(indexedRecordIssues);
  analyzeRustObjectProjections(program, context.nativeNodes, context.records.objectProjectionPlans);
  const callableDeclarationIssues = analyzeRustCallableDeclarationEmission({ program, callableEntries, source: context.source, reachability, nodes: context.nativeNodes,
    producer: context.records.callableDeclarationPlans });
  if (callableDeclarationIssues.length !== 0) return rejectedTargetStage(callableDeclarationIssues);
  const methodEmissionIssues = analyzeRustMethodEmission({ program, callableEntries, nodes: context.nativeNodes, producer: context.records.methodEmissionPlans });
  if (methodEmissionIssues.length !== 0) return rejectedTargetStage(methodEmissionIssues);
  analyzeRustFrameEmission({ program, sourceFiles: context.sourceFiles, nodes: context.nativeNodes, producer: context.records.frameEmissionPlans,
    nativeTypeFor: carrier => context.callableValues.frames.nativeTypeFor(carrier, program.classValues) });
  analyzeRustSuspendedCallableEmission({ program, sourceFiles: context.sourceFiles, producer: context.records.suspendedCallablePlans });
  const constructionEmissionIssues = analyzeRustConstructionEmission({ program, producer: context.records.constructionPlans });
  if (constructionEmissionIssues.length !== 0) return rejectedTargetStage(constructionEmissionIssues);
  const bindingLivenessIssues = analyzeRustBindingLiveness(context.source, flow, records, context.names,
    program.physicalEmissionContexts, context.records.bindingLivenessPlans);
  if (bindingLivenessIssues.length !== 0) return rejectedTargetStage(bindingLivenessIssues);
  const localBindingIssues = analyzeRustLocalBindings({ ast: context.ast, nodes: context.nativeNodes, records,
    navigation: context.source.navigation, names: context.names, aliases: program.localStorageAliases,
    representations: objectRepresentations, projectTypes, nativeStorage: program.callableValues.nativeStorage,
    lexicalFunctions: program.lexicalFunctions, producer: context.records.localBindings, required: context.requiredRecords,
    runtimeValueUses: context.runtimeValueUses, safetyApplications: program.safetyApplications });
  if (localBindingIssues.length !== 0) return rejectedTargetStage(localBindingIssues);
  const classEmissionIssues = analyzeRustClassEmission({ program, source: context.source, reachability, producer: context.records.classEmissionPlans });
  if (classEmissionIssues.length !== 0) return rejectedTargetStage(classEmissionIssues);
  analyzeRustClassValueEmission({ program, nodes: context.nativeNodes, producer: context.records.classEmissionPlans });
  analyzeRustProjectMemberErrors(program, context.nativeNodes, context.records.errorEmissionPlans);
  analyzeRustDeclarationErrorOwners(program, context.nativeNodes, context.records.errorEmissionPlans);
  const sourceRegionIssues = analyzeRustSourceErrorRegions(program, context.nativeNodes, context.records.errorEmissionPlans);
  if (sourceRegionIssues.length !== 0) return rejectedTargetStage(sourceRegionIssues);
  analyzeRustSourceBindingEmission(program, context.nativeNodes, context.records.sourceBindingEmissionPlans);
  const providerMutableIssues = analyzeRustProviderMutableEmission(program, context.nativeNodes, context.records.providerEvaluationPlans);
  if (providerMutableIssues.length !== 0) return rejectedTargetStage(providerMutableIssues);
  const providerEvaluationIssues = analyzeRustProviderEvaluation(program, context.records.providerEvaluationPlans);
  if (providerEvaluationIssues.length !== 0) return rejectedTargetStage(providerEvaluationIssues);
  const projectClassLayoutIssues = analyzeRustProjectClassLayouts(program, context.source, context.nativeNodes,
    context.records.projectClassPlans, reachability, classContexts, headerPlacements.root);
  if (projectClassLayoutIssues.length !== 0) return rejectedTargetStage(projectClassLayoutIssues);
  const bindingEmissionIssues = analyzeRustBindingProjectionEmission({ program, nodes: context.nativeNodes, producer: context.records.bindingEmission });
  if (bindingEmissionIssues.length !== 0) return rejectedTargetStage(bindingEmissionIssues);
  const objectLiteralIssues = analyzeRustObjectLiteralEmission(program, context.nativeNodes, context.records.objectLiteralEmissionPlans,
    node => context.semanticsFor(node).propertyNames.get(node),
    node => context.semanticsFor(node).operations.objectLiteralElement(node), context.source);
  if (objectLiteralIssues.length !== 0) return rejectedTargetStage(objectLiteralIssues);
  for (const file of context.sourceFiles) headerPlacements.module(file);
  for (const definition of program.projectTypes.definitions) headerPlacements.directClass(definition);
  analyzeRustCarrierReads(program, context.nativeNodes, context.records.carrierReadPlans);
  const sourceFileEmissionIssues = analyzeRustSourceFileEmission(program, context.records.sourceFileEmissionPlans);
  if (sourceFileEmissionIssues.length !== 0) return rejectedTargetStage(sourceFileEmissionIssues);
  const dispatchRootIssues = analyzeRustDispatchRootEmission(program, errorEmission.plan, context.nativeNodes, context.records.dispatchContextEmissionPlans);
  if (dispatchRootIssues.length !== 0) return rejectedTargetStage(dispatchRootIssues);
  const binaryDispatchIssues = analyzeRustBinaryDispatchEmission(program, errorEmission.plan, context.records.dispatchContextEmissionPlans);
  if (binaryDispatchIssues.length !== 0) return rejectedTargetStage(binaryDispatchIssues);
  const programEmissionIssues = analyzeRustProgramEmission(program, context.records.sourcePackageEmission);
  if (programEmissionIssues.length !== 0) return rejectedTargetStage(programEmissionIssues);
  const packageCargoIssues = analyzeRustPackageCargo(program, context.records.sourcePackageEmission);
  if (packageCargoIssues.length !== 0) return rejectedTargetStage(packageCargoIssues);
  const genericRequirementEmissionIssues = analyzeRustGenericRequirementEmission(program, context.nativeNodes, context.records.nativeGenericPlans);
  if (genericRequirementEmissionIssues.length !== 0) return rejectedTargetStage(genericRequirementEmissionIssues);
  // Provider reads select Copy/Clone from the declaration-owned clone guarantees published just above.
  const providerReads = selectRustProviderReads(program, context.nativeNodes);
  if (providerReads.diagnostics.length !== 0) return rejectedTargetStage(providerReads.diagnostics);
  const arrayLiteralIssues = analyzeRustArrayLiterals(program, context.nativeNodes, context.records.arrayLiteralPlans);
  if (arrayLiteralIssues.length !== 0) return rejectedTargetStage(arrayLiteralIssues);
  const propertyProjectionIssues = analyzeRustPropertyValueProjection(program, context.nativeNodes, context.records.propertyValueProjectionPlans);
  if (propertyProjectionIssues.length !== 0) return rejectedTargetStage(propertyProjectionIssues);
  const optionalChainIssues = analyzeRustOptionalChainEmission(program, context.nativeNodes, context.records.optionalChainEmissionPlans, context.requiredRecords);
  if (optionalChainIssues.length !== 0) return rejectedTargetStage(optionalChainIssues);
  analyzeRustCompletionBindings(program, context.nativeNodes, context.records.completionBindingPlans);
  const valueReadIssues = analyzeRustValueReads(program, context.nativeNodes, providerReads.reads, context.records.valueReadPlans,
    context.records.valueProjectionPlans, context.records.conversionEmissionPlans);
  if (valueReadIssues.length !== 0) return rejectedTargetStage(valueReadIssues);
  context.records.valueReadPlans.promises(program.promiseResults);
  const propertyReadIssues = analyzeRustPropertyReads(program, context.nativeNodes, context.records.propertyReadPlans);
  if (propertyReadIssues.length !== 0) return rejectedTargetStage(propertyReadIssues);
  const lambdaEmissionIssues = analyzeRustLambdaEmission(program, context.nativeNodes, context.records.lambdaEmissionPlans);
  if (lambdaEmissionIssues.length !== 0) return rejectedTargetStage(lambdaEmissionIssues);
  const callableEmissionTypes = analyzeRustCallableEmission(program, context.nativeNodes, context.records.callableConversionPlans, operationAttempts);
  const providerFormIssues = analyzeRustProviderForms(program, providerReads.reads, context.records.providerFormPlans, operationAttempts);
  if (providerFormIssues.length !== 0) return rejectedTargetStage(providerFormIssues);
  const recordFieldIssues = analyzeRustRecordFieldStorage(program, context.nativeNodes, context.records.callableConversionPlans);
  if (recordFieldIssues.length !== 0) return rejectedTargetStage(recordFieldIssues);
  const sourceCallIssues = analyzeRustSourceCalls(program, context.nativeNodes, context.records.sourceCallPlans);
  if (sourceCallIssues.length !== 0) return rejectedTargetStage(sourceCallIssues);
  const callAdmissionIssues = admitRustCalls(program, context.nativeNodes);
  if (callAdmissionIssues.length !== 0) return rejectedTargetStage(callAdmissionIssues);
  const expressionSyntaxIssues = analyzeRustExpressionSyntax(program, context.nativeNodes, context.records.expressionSyntaxPlans);
  if (expressionSyntaxIssues.length !== 0) return rejectedTargetStage(expressionSyntaxIssues);
  const integerTruncationIssues = analyzeRustIntegerTruncation(program, context.nativeNodes, context.records.integerTruncationPlans);
  if (integerTruncationIssues.length !== 0) return rejectedTargetStage(integerTruncationIssues);
  const providerInputIssues = analyzeRustProviderInputs(program, context.records.providerInputPlans);
  if (providerInputIssues.length !== 0) return rejectedTargetStage(providerInputIssues);
  const referenceOperationIssues = analyzeRustReferenceOperations(program, context.nativeNodes, context.records.referenceOperationPlans);
  if (referenceOperationIssues.length !== 0) return rejectedTargetStage(referenceOperationIssues);
  const nullishCoalescingIssues = analyzeRustNullishCoalescing(program, context.nativeNodes, context.records.nullishCoalescingPlans);
  if (nullishCoalescingIssues.length !== 0) return rejectedTargetStage(nullishCoalescingIssues);
  const flowReadEmissionIssues = analyzeRustFlowReadEmission(program, context.nativeNodes, context.records.flowReadEmissionPlans);
  if (flowReadEmissionIssues.length !== 0) return rejectedTargetStage(flowReadEmissionIssues);
  const projectUnionMappingIssues = analyzeRustProjectUnionMappings(program, context.nativeNodes, context.records.projectUnionMappingPlans);
  if (projectUnionMappingIssues.length !== 0) return rejectedTargetStage(projectUnionMappingIssues);
  const receiverCaptureIssues = analyzeRustReceiverCaptureEmission(program, context.nativeNodes, context.records.receiverCaptureEmissionPlans);
  if (receiverCaptureIssues.length !== 0) return rejectedTargetStage(receiverCaptureIssues);
  const errorFieldIssues = analyzeRustErrorFieldBorrows(program, context.nativeNodes, context.records.errorFieldPlans, context.requiredRecords);
  if (errorFieldIssues.length !== 0) return rejectedTargetStage(errorFieldIssues);
  admitRustUnionProjections(program, context.nativeNodes);
  analyzeRustUnionEquality(program, context.nativeNodes, context.records.unionEqualityPlans);
  analyzeRustClosedTypeTests(program, context.nativeNodes, context.records.closedTypeTestPlans);
  const optionEqualityIssues = analyzeRustOptionEquality(program, context.nativeNodes, context.records.optionEqualityPlans);
  if (optionEqualityIssues.length !== 0) return rejectedTargetStage(optionEqualityIssues);
  analyzeRustIndexedLocations(program, context.nativeNodes, context.records.indexedLocationPlans);
  analyzeRustLocationCallbacks(program, context.nativeNodes, context.records.locationCallbackPlans, context.records);
  analyzeRustErasedInputArguments(program, context.records.erasedInputArgumentPlans);
  const sourceCallArgumentIssues = analyzeRustSourceCallArguments(program, context.nativeNodes, context.records.sourceCallArgumentPlans, context.source);
  if (sourceCallArgumentIssues.length !== 0) return rejectedTargetStage(sourceCallArgumentIssues);
  analyzeRustUnionCalls(program, context.nativeNodes, context.records.unionCallPlans, context.records.conversionEmissionPlans);
  const directStorageIssues = analyzeRustDirectStorage(program, context.nativeNodes, context.records.directStoragePlans, context.records);
  if (directStorageIssues.length !== 0) return rejectedTargetStage(directStorageIssues);
  const assignmentEvaluationIssues = analyzeRustAssignmentEvaluation(program, context.nativeNodes, context.records.assignmentEvaluationPlans);
  if (assignmentEvaluationIssues.length !== 0) return rejectedTargetStage(assignmentEvaluationIssues);
  const unaryIssues = analyzeRustUnaryEmission(program, context.nativeNodes, context.records.unaryEmissionPlans);
  if (unaryIssues.length !== 0) return rejectedTargetStage(unaryIssues);
  const locationStorageIssues = analyzeRustLocationStorage(program, context.nativeNodes, context.records.locationStoragePlans,
    context.records, context.requiredRecords);
  if (locationStorageIssues.length !== 0) return rejectedTargetStage(locationStorageIssues);
  const computedMemberIssues = admitRustComputedMembers(program, context.nativeNodes);
  if (computedMemberIssues.length !== 0) return rejectedTargetStage(computedMemberIssues);
  analyzeRustNativeComparisons(program, context.nativeNodes, context.records.nativeComparisonPlans);
  const binaryIssues = analyzeRustBinaryEmission(program, context.nativeNodes, context.records.binaryEmissionPlans);
  if (binaryIssues.length !== 0) return rejectedTargetStage(binaryIssues);
  const literalIssues = analyzeRustLiteralEmission(program, context.nativeNodes, context.records.literalEmissionPlans, context.source);
  if (literalIssues.length !== 0) return rejectedTargetStage(literalIssues);
  const templateIssues = analyzeRustTemplateStrings(program, context.nativeNodes, context.records.templateStringPlans);
  if (templateIssues.length !== 0) return rejectedTargetStage(templateIssues);
  const assertionIssues = analyzeRustSourceAssertions(program, context.nativeNodes, context.records.sourceAssertionPlans);
  if (assertionIssues.length !== 0) return rejectedTargetStage(assertionIssues);
  analyzeRustStringComparisonViews(program, context.nativeNodes, context.records.stringComparisonPlans);
  analyzeRustArgumentViews(program, context.nativeNodes, context.records.argumentViewPlans);
  const nativeLayoutTypes = analyzeRustNativeMemoryEmission(program, context.nativeNodes, context.records.nativeLayoutPlans);
  const errorObservationIssues = admitRustErrorObservations(program, context.nativeNodes);
  if (errorObservationIssues.length !== 0) return rejectedTargetStage(errorObservationIssues);
  analyzeRustTypeEmission(program, context.nativeNodes, context.records.typeEmissionPlans,
    [...nativeLayoutTypes, ...sourceCallableEmission.types, ...objectReferenceEmission.types, ...callableEmissionTypes], context.records.projectEmissionPlans);
  const errorModuleIssues = analyzeRustProgramErrorModuleEmission(program, errorEmission.plan, context.records.errorTransportEmissionPlans);
  if (errorModuleIssues.length !== 0) return rejectedTargetStage(errorModuleIssues);
  // Storage visibility covers every declaration a native class layout stores: members, constructor parameter
  // properties and inherited external fields, as well as the class members themselves.
  analyzeRustNativeMemberVisibility(program.source.ast, program.projectTypes.definitions.flatMap(definition => [
    ...sourceObjectMemberDeclarations(program.source.ast, definition.declaration).filter((member): member is Node => member !== undefined),
    ...(program.projectTypes.objectLayoutForDefinition(definition)?.fields ?? []).map(field => field.declaration),
    ...(program.projectTypes.externalBaseForDefinition(definition)?.fields ?? []).map(field => field.declaration),
  ]), context.records.classEmissionPlans);
  analyzeRustDeclarationLiveness({ program, reachability, nodes: context.nativeNodes,
    producer: context.records.nativeLiveness, required: context.requiredRecords });
  analyzeRustStructuralLivenessEmission(program, reachability, context.records.nativeLiveness);
  analyzeRustSignatureVisibility(program, context.nativeNodes, context.records.sourcePackageEmission);
  const artifactIssues = analyzeRustSourceArtifacts(program, context.nativeNodes, context.records.sourceArtifactPlans);
  if (artifactIssues.length !== 0) return rejectedTargetStage(artifactIssues);
  const safetyEmissionIssues = analyzeRustSafetyEmission(program, context.records.safetyEmissionPlans);
  if (safetyEmissionIssues.length !== 0) return rejectedTargetStage(safetyEmissionIssues);
  return resolvedTargetStage(Object.freeze({ reachability, nativeDeclarations: nativeDeclarations.forms }));
}

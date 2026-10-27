import { createRustBindingLivenessProducer } from "../storage/binding-liveness.js";
import { createRustNativeTaskProducer } from "../native/native-tasks.js";
import { createRustSourceNameProducer } from "../names.js";
import { createRustSourcePackageEmissionProducer } from "./source-packages.js";
import { createRustSourceArtifactProducer } from "./artifacts.js";
import { createRustSafetyEmissionProducer } from "../storage/safety-emission.js";
import { createRustArrayLiteralProducer } from "../operations/array-literals.js";
import { createRustPropertyValueProjectionProducer } from "../objects/property-value-projection.js";
import { createRustOptionalChainEmissionProducer } from "../operations/optional-chain-emission.js";
import { createRustOwnershipEmissionProducer } from "../storage/ownership-emission.js";
import { createRustValueReadProducer } from "../storage/value-read.js";
import { createRustLiteralEmissionProducer } from "../operations/literal-emission.js";
import { createRustTemplateStringProducer } from "../operations/template-strings.js";
import { createRustNativeComparisonProducer } from "../native/native-comparisons.js";
import { createRustUnionEqualityProducer } from "../operations/union-equality.js";
import { createRustClosedTypeTestProducer } from "../types/type-tests.js";
import { createRustOptionEqualityProducer } from "../operations/option-equality.js";
import { createRustIndexedLocationProducer } from "../storage/indexed-locations.js";
import { createRustLocationCallbackProducer } from "../callables/location-callbacks.js";
import { createRustErasedInputArgumentProducer } from "../calls/erased-input-arguments.js";
import { createRustDirectStorageProducer } from "../storage/direct-storage.js";
import { createRustUnaryEmissionProducer } from "../operations/expression-unary.js";
import { createRustFlowReadEmissionProducer } from "../operations/flow-read-emission.js";
import { createRustProjectUnionMappingProducer } from "../types/project-union-mappings.js";
import { createRustReceiverCaptureEmissionProducer } from "../callables/receiver-captures.js";
import { createRustSourceCallableEmissionProducer } from "../callables/source-callable-emission.js";
import { createRustReferenceOperationProducer } from "../operations/reference-operations.js";
import { createRustNullishCoalescingProducer } from "../operations/nullish-coalescing.js";
import { createRustObjectReferenceEmissionProducer } from "../objects/object-reference-views.js";
import { createRustSourceCallArgumentProducer } from "../calls/source-call-arguments.js";
import { createRustBinaryEmissionProducer } from "../operations/expression-binary.js";
import { createRustAssignmentEvaluationProducer } from "../storage/assignment-evaluation.js";
import { createRustLocationStorageProducer } from "../storage/location-storage.js";
import { createRustErrorFieldProducer } from "../errors/error-field-borrows.js";
import { createRustStringComparisonViewProducer } from "../operations/string-comparison-views.js";
import { createRustGenericCallableFlowProducer } from "../callables/generic-callable-flow.js";
import { createRustNativeLayoutProducer } from "../native/native-layout-emission.js";
import { createRustSourceAssertionProducer } from "../operations/source-assertions.js";
import { createRustSourceBindingEmissionProducer } from "../storage/binding-paths.js";
import { createRustSourceFileEmissionProducer } from "./source-file-emission.js";
import { createRustProviderEvaluationProducer } from "../native/provider-evaluation.js";
import { createRustProviderInputProducer } from "../native/provider-inputs.js";
import { createRustLambdaEmissionProducer } from "../callables/lambda-emission.js";
import { createRustIntegerTruncationProducer } from "../operations/integer-truncation.js";
import { createRustProviderFormProducer } from "../native/provider-forms.js";
import { createRustCallableConversionProducer } from "../callables/callable-conversions.js";
import { createRustArgumentViewProducer } from "../calls/argument-views.js";
import { createRustRecordContributionProducer } from "../objects/record-contributions.js";
import { createRustUnionCallProducer } from "../calls/union-calls.js";
import { createRustPropertyReadProducer } from "../objects/property-reads.js";
import { createRustSourceCallProducer } from "../calls/source-calls.js";
import { createRustExpressionSyntaxProducer } from "../operations/expression-syntax.js";
import { createRustValueProjectionProducer } from "../objects/value-projection.js";
import { createRustExpressionExitProducer } from "../operations/expression-exits.js";
import { createRustCompletionBindingProducer } from "../storage/completion-bindings.js";
import { createRustConversionEmissionProducer } from "../operations/conversion-emission.js";
import { createRustErrorTransportEmissionProducer } from "../errors/error-transport.js";
import { createRustDispatchContextEmissionProducer } from "../operations/dispatch-contexts.js";
import { createRustTypeEmissionProducer } from "../types/type-emission.js";
import { createRustBorrowedInitializerProducer } from "../storage/borrowed-initializers.js";
import { createRustCaptureStorageProducer } from "../callables/capture-storage.js";
import { createRustBindingEmissionProducer } from "../storage/binding-emission.js";

import { createRustStatementExitProducer } from "../operations/statement-exits.js";
import { createRustStatementCompletionProducer } from "../operations/statement-completion.js";
import { createRustResourceScopeProducer } from "../storage/resource-scopes.js";
import { createRustLocalBindingProducer } from "../storage/local-bindings.js";
import { createRustFieldProjectionAssignmentProducer } from "../storage/field-projection-assignment.js";
import { createRustAssignmentWriteProducer } from "../storage/assignment-writes.js";
import { createRustBorrowedElementProducer } from "../storage/borrowed-element-reads.js";
import { createRustFieldWriteProducer } from "../storage/field-writes.js";
import { createRustDeclarationEmissionProducer } from "./declaration-emission.js";
import { createRustLexicalValueProducer } from "../storage/lexical-values.js";
import { createRustNativeProtocolProducer } from "../native/native-protocol-emission.js";
import { createRustErrorEmissionProducer } from "../errors/error-emission.js";
import { createRustClassInitializationProducer } from "../objects/class-initialization.js";
import { createRustCallableParameterProducer } from "../calls/parameter-emission.js";
import { createRustGenericEmissionProducer } from "../types/generic-emission.js";
import { createRustLexicalFunctionProducer } from "../callables/lexical-functions.js";
import { createRustCallableDeclarationProducer } from "../callables/callable-emission.js";
import { createRustMethodEmissionProducer } from "./method-emission.js";
import { createRustFrameEmissionProducer } from "../callables/frame-emission.js";
import { createRustSuspendedCallableProducer } from "../callables/suspended-callables.js";
import { createRustConstructionProducer } from "../objects/construction.js";
import { createRustClassEmissionProducer } from "../objects/class-emission.js";
import { createRustProjectEmissionProducer } from "./project-emission.js";
import { createRustCarrierReadProducer } from "../storage/carrier-reads.js";
import { createRustIndexedRecordProducer } from "../objects/indexed-records.js";
import { createRustObjectProjectionProducer } from "../objects/object-projections.js";
import { createRustStructuralEmissionProducer } from "../objects/structural-emission.js";
import { createRustStoredFieldProducer } from "../storage/stored-fields.js";
import { createRustProjectClassProducer } from "../objects/project-classes.js";
import { createRustObjectLiteralEmissionProducer } from "../objects/object-literal-emission.js";
import { createRustNativeDeclarationProducer } from "../native/native-declarations.js";
import { createRustNativeLivenessProducer } from "../native/native-liveness.js";
import { createRustNativeGenericProducer } from "../native/native-generics.js";

export function createRustEmissionRecordProducers(assertOpen: () => void) {
  const statementExits = createRustStatementExitProducer(assertOpen);
  const statementCompletions = createRustStatementCompletionProducer(assertOpen);
  const resourceScopes = createRustResourceScopeProducer(assertOpen);
  const localBindings = createRustLocalBindingProducer(assertOpen);
  const fieldProjectionAssignments = createRustFieldProjectionAssignmentProducer(assertOpen);
  const assignmentWrites = createRustAssignmentWriteProducer(assertOpen);
  const borrowedElements = createRustBorrowedElementProducer(assertOpen);
  const fieldWrites = createRustFieldWriteProducer(assertOpen);
  const borrowedInitializers = createRustBorrowedInitializerProducer(assertOpen);
  const captureStorage = createRustCaptureStorageProducer(assertOpen);
  const bindingEmission = createRustBindingEmissionProducer(assertOpen);
  const declarationEmission = createRustDeclarationEmissionProducer(assertOpen);
  const lexicalValuePlans = createRustLexicalValueProducer(assertOpen);
  const nativeProtocolPlans = createRustNativeProtocolProducer(assertOpen);
  const errorEmissionPlans = createRustErrorEmissionProducer(assertOpen);
  const classInitializationPlans = createRustClassInitializationProducer(assertOpen);
  const callableParameterPlans = createRustCallableParameterProducer(assertOpen);
  const genericEmissionPlans = createRustGenericEmissionProducer(assertOpen);
  const lexicalFunctionPlans = createRustLexicalFunctionProducer(assertOpen);
  const callableDeclarationPlans = createRustCallableDeclarationProducer(assertOpen);
  const methodEmissionPlans = createRustMethodEmissionProducer(assertOpen);
  const frameEmissionPlans = createRustFrameEmissionProducer(assertOpen);
  const suspendedCallablePlans = createRustSuspendedCallableProducer(assertOpen);
  const constructionPlans = createRustConstructionProducer(assertOpen);
  const classEmissionPlans = createRustClassEmissionProducer(assertOpen);
  const projectEmissionPlans = createRustProjectEmissionProducer(assertOpen);
  const sourcePackageEmission = createRustSourcePackageEmissionProducer(assertOpen);
  const sourceArtifactPlans = createRustSourceArtifactProducer(assertOpen);
  const safetyEmissionPlans = createRustSafetyEmissionProducer(assertOpen);
  const arrayLiteralPlans = createRustArrayLiteralProducer(assertOpen);
  const propertyValueProjectionPlans = createRustPropertyValueProjectionProducer(assertOpen);
  const optionalChainEmissionPlans = createRustOptionalChainEmissionProducer(assertOpen);
  const ownershipEmissionPlans = createRustOwnershipEmissionProducer(assertOpen);
  const valueReadPlans = createRustValueReadProducer(assertOpen);
  const literalEmissionPlans = createRustLiteralEmissionProducer(assertOpen);
  const templateStringPlans = createRustTemplateStringProducer(assertOpen);
  const nativeComparisonPlans = createRustNativeComparisonProducer(assertOpen);
  const unionEqualityPlans = createRustUnionEqualityProducer(assertOpen);
  const closedTypeTestPlans = createRustClosedTypeTestProducer(assertOpen);
  const optionEqualityPlans = createRustOptionEqualityProducer(assertOpen);
  const indexedLocationPlans = createRustIndexedLocationProducer(assertOpen);
  const locationCallbackPlans = createRustLocationCallbackProducer(assertOpen);
  const erasedInputArgumentPlans = createRustErasedInputArgumentProducer(assertOpen);
  const directStoragePlans = createRustDirectStorageProducer(assertOpen);
  const unaryEmissionPlans = createRustUnaryEmissionProducer(assertOpen);
  const flowReadEmissionPlans = createRustFlowReadEmissionProducer(assertOpen);
  const projectUnionMappingPlans = createRustProjectUnionMappingProducer(assertOpen);
  const receiverCaptureEmissionPlans = createRustReceiverCaptureEmissionProducer(assertOpen);
  const sourceCallableEmissionPlans = createRustSourceCallableEmissionProducer(assertOpen);
  const referenceOperationPlans = createRustReferenceOperationProducer(assertOpen);
  const nullishCoalescingPlans = createRustNullishCoalescingProducer(assertOpen);
  const objectReferenceEmissionPlans = createRustObjectReferenceEmissionProducer(assertOpen);
  const sourceCallArgumentPlans = createRustSourceCallArgumentProducer(assertOpen);
  const binaryEmissionPlans = createRustBinaryEmissionProducer(assertOpen);
  const assignmentEvaluationPlans = createRustAssignmentEvaluationProducer(assertOpen);
  const locationStoragePlans = createRustLocationStorageProducer(assertOpen);
  const errorFieldPlans = createRustErrorFieldProducer(assertOpen);
  const stringComparisonPlans = createRustStringComparisonViewProducer(assertOpen);
  const genericFlowApplications = createRustGenericCallableFlowProducer(assertOpen);
  const nativeLayoutPlans = createRustNativeLayoutProducer(assertOpen);
  const sourceAssertionPlans = createRustSourceAssertionProducer(assertOpen);
  const sourceBindingEmissionPlans = createRustSourceBindingEmissionProducer(assertOpen);
  const sourceFileEmissionPlans = createRustSourceFileEmissionProducer(assertOpen);
  const providerEvaluationPlans = createRustProviderEvaluationProducer(assertOpen);
  const providerInputPlans = createRustProviderInputProducer(assertOpen);
  const lambdaEmissionPlans = createRustLambdaEmissionProducer(assertOpen);
  const integerTruncationPlans = createRustIntegerTruncationProducer(assertOpen);
  const providerFormPlans = createRustProviderFormProducer(assertOpen);
  const callableConversionPlans = createRustCallableConversionProducer(assertOpen);
  const argumentViewPlans = createRustArgumentViewProducer(assertOpen);
  const recordContributionPlans = createRustRecordContributionProducer(assertOpen);
  const unionCallPlans = createRustUnionCallProducer(assertOpen);
  const propertyReadPlans = createRustPropertyReadProducer(assertOpen);
  const sourceCallPlans = createRustSourceCallProducer(assertOpen);
  const expressionSyntaxPlans = createRustExpressionSyntaxProducer(assertOpen);
  const valueProjectionPlans = createRustValueProjectionProducer(assertOpen);
  const expressionExitPlans = createRustExpressionExitProducer(assertOpen);
  const completionBindingPlans = createRustCompletionBindingProducer(assertOpen);
  const bindingLivenessPlans = createRustBindingLivenessProducer(assertOpen);
  const sourceNamePlans = createRustSourceNameProducer(assertOpen);
  const conversionEmissionPlans = createRustConversionEmissionProducer(assertOpen);
  const errorTransportEmissionPlans = createRustErrorTransportEmissionProducer(assertOpen);
  const dispatchContextEmissionPlans = createRustDispatchContextEmissionProducer(assertOpen);
  const carrierReadPlans = createRustCarrierReadProducer(assertOpen);
  const typeEmissionPlans = createRustTypeEmissionProducer(assertOpen);
  const indexedRecordPlans = createRustIndexedRecordProducer(assertOpen);
  const objectProjectionPlans = createRustObjectProjectionProducer(assertOpen);
  const structuralEmissionPlans = createRustStructuralEmissionProducer(assertOpen);
  const storedFieldPlans = createRustStoredFieldProducer(assertOpen);
  const projectClassPlans = createRustProjectClassProducer(assertOpen);
  const objectLiteralEmissionPlans = createRustObjectLiteralEmissionProducer(assertOpen);
  const nativeDeclarations = createRustNativeDeclarationProducer(assertOpen);
  const nativeLiveness = createRustNativeLivenessProducer(assertOpen);
  const nativeGenericPlans = createRustNativeGenericProducer(assertOpen);
  const nativeTaskPlans = createRustNativeTaskProducer(assertOpen);

  return Object.freeze({
    readers: Object.freeze({
    ...nativeTaskPlans.records,

    ...borrowedElements.records,
    ...fieldWrites.records,
    borrowedInitializer: borrowedInitializers.records,
    captureStorageScope: captureStorage.records,
    bindingProjectionEmission: bindingEmission.records,
    ...declarationEmission.records,
    nativeDeclaration: nativeDeclarations.declarations,
    nativeTypeFamilyImplementations: nativeDeclarations.implementations,
    declarationLiveness: nativeLiveness.declarations,
    ...nativeLiveness.emission,
    nativeGenerics: nativeGenericPlans.records,
    ...typeEmissionPlans.records,
    ...nativeGenericPlans.emission,
    lexicalValues: lexicalValuePlans.records,
    nativeProtocols: nativeProtocolPlans.inventories,
    nativeProtocol: nativeProtocolPlans.protocol,
    nativeProtocolInput: nativeProtocolPlans.inputs,
    nativeInputInvocation: nativeProtocolPlans.calls,
    ...errorEmissionPlans.records,
    nativeErrorRegion: errorEmissionPlans.regions,
    classInitialization: classInitializationPlans.classes,
    staticFieldStorage: classInitializationPlans.fields,
    callableParameter: callableParameterPlans.records,
    ...genericEmissionPlans.records,
    lexicalFunction: lexicalFunctionPlans.records,
    callableDeclaration: callableDeclarationPlans.records,
    ...methodEmissionPlans.records,
    ...frameEmissionPlans.records,
    suspendedDeclaration: suspendedCallablePlans.implementations,
    suspendedDeclarations: suspendedCallablePlans.declarations,
    classConstruction: constructionPlans.records,
    ...constructionPlans.emissionRecords,
    nativeClass: classEmissionPlans.records,
    ...classEmissionPlans.visibilityRecords,
    ...classEmissionPlans.environmentRecords,
    ...classEmissionPlans.forwarderRecords,
    ...classEmissionPlans.implementationRecords,
    ...projectEmissionPlans.records,
    ...sourcePackageEmission.records,
    ...sourceArtifactPlans.records,
    ...safetyEmissionPlans.records,
    ...arrayLiteralPlans.records,
    ...propertyValueProjectionPlans.records,
    ...optionalChainEmissionPlans.records,
    ...ownershipEmissionPlans.records,
    ...valueReadPlans.records,
    ...literalEmissionPlans.records,
    ...templateStringPlans.records,
    ...nativeComparisonPlans.records,
    ...unionEqualityPlans.records,
    ...closedTypeTestPlans.records,
    ...optionEqualityPlans.records,
    ...indexedLocationPlans.records,
    ...locationCallbackPlans.records,
    ...erasedInputArgumentPlans.records,
    ...directStoragePlans.records,
    ...locationStoragePlans.records,
    ...unaryEmissionPlans.records,
    ...flowReadEmissionPlans.records,
    ...projectUnionMappingPlans.records,
    ...receiverCaptureEmissionPlans.records,
    ...sourceCallableEmissionPlans.records,
    ...referenceOperationPlans.records,
    ...nullishCoalescingPlans.records,
    ...objectReferenceEmissionPlans.records,
    ...sourceCallArgumentPlans.records,
    ...binaryEmissionPlans.records,
    ...assignmentEvaluationPlans.records,
    ...errorFieldPlans.records,
    ...stringComparisonPlans.records,
    ...genericFlowApplications.records,
    ...nativeLayoutPlans.records,
    ...sourceAssertionPlans.records,
    ...sourceBindingEmissionPlans.records,
    ...sourceFileEmissionPlans.records,
    ...providerEvaluationPlans.records,
    ...providerInputPlans.records,
    ...lambdaEmissionPlans.records,
    ...integerTruncationPlans.records,
    ...providerFormPlans.records,
    ...callableConversionPlans.records,
    ...argumentViewPlans.records,
    ...recordContributionPlans.records,
    ...unionCallPlans.records,
    ...propertyReadPlans.records,
    ...sourceCallPlans.records,
    ...expressionSyntaxPlans.records,
    ...valueProjectionPlans.records,
    ...expressionExitPlans.records,
    ...completionBindingPlans.records,
    ...bindingLivenessPlans.records,
    ...sourceNamePlans.records,
    ...conversionEmissionPlans.records,
    ...errorTransportEmissionPlans.records,
    ...dispatchContextEmissionPlans.records,
    ...carrierReadPlans.records,
    ...indexedRecordPlans.records,
    ...objectProjectionPlans.records,
    ...structuralEmissionPlans.records,
    ...storedFieldPlans.records,
    ...projectClassPlans.records,
    ...objectLiteralEmissionPlans.records,
    ...statementCompletions.records,
    ...resourceScopes.records,
    localBinding: localBindings.records,
    fieldProjectionAssignment: fieldProjectionAssignments.records,
    assignmentWrite: assignmentWrites.records,
    statementExit: statementExits.records,
    moduleFallthrough: statementExits.modules,
    loopForm: statementExits.forms,

    }),
    writers: Object.freeze({
    statementExits,
    statementCompletions,
    resourceScopes,
    localBindings,
    fieldProjectionAssignments,
    assignmentWrites,
    borrowedElements,
    fieldWrites,
    borrowedInitializers,
    captureStorage,
    bindingEmission,
    declarationEmission,
    lexicalValuePlans,
    nativeProtocolPlans,
    errorEmissionPlans,
    classInitializationPlans,
    callableParameterPlans,
    genericEmissionPlans,
    lexicalFunctionPlans,
    callableDeclarationPlans,
    methodEmissionPlans,
    frameEmissionPlans,
    suspendedCallablePlans,
    constructionPlans,
    classEmissionPlans,
    projectEmissionPlans,
    sourcePackageEmission,
    sourceArtifactPlans,
    safetyEmissionPlans,
    arrayLiteralPlans,
    propertyValueProjectionPlans,
    optionalChainEmissionPlans,
    ownershipEmissionPlans,
    valueReadPlans,
    literalEmissionPlans,
    templateStringPlans,
    nativeComparisonPlans,
    unionEqualityPlans,
    closedTypeTestPlans,
    optionEqualityPlans,
    indexedLocationPlans,
    locationCallbackPlans,
    erasedInputArgumentPlans,
    directStoragePlans,
    locationStoragePlans,
    unaryEmissionPlans,
    flowReadEmissionPlans,
    projectUnionMappingPlans,
    receiverCaptureEmissionPlans,
    sourceCallableEmissionPlans,
    referenceOperationPlans,
    nullishCoalescingPlans,
    objectReferenceEmissionPlans,
    sourceCallArgumentPlans,
    binaryEmissionPlans,
    assignmentEvaluationPlans,
    errorFieldPlans,
    stringComparisonPlans,
    genericFlowApplications,
    nativeLayoutPlans,
    sourceAssertionPlans,
    sourceBindingEmissionPlans,
    sourceFileEmissionPlans,
    providerEvaluationPlans,
    providerInputPlans,
    lambdaEmissionPlans,
    integerTruncationPlans,
    providerFormPlans,
    callableConversionPlans,
    argumentViewPlans,
    recordContributionPlans,
    unionCallPlans,
    propertyReadPlans,
    sourceCallPlans,
    expressionSyntaxPlans,
    valueProjectionPlans,
    expressionExitPlans,
    completionBindingPlans,
    bindingLivenessPlans,
    sourceNamePlans,
    conversionEmissionPlans,
    errorTransportEmissionPlans,
    dispatchContextEmissionPlans,
    carrierReadPlans,
    typeEmissionPlans,
    indexedRecordPlans,
    objectProjectionPlans,
    structuralEmissionPlans,
    storedFieldPlans,
    projectClassPlans,
    objectLiteralEmissionPlans,
    nativeDeclarations,
    nativeLiveness,
    nativeGenericPlans,
    nativeTaskPlans,
    }),
  });
}

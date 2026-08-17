import {
  defaultValueFactKey,
  flowStateFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  SourceCallMarkerKind,
} from "@tsonic/tsts";
import {
  orderEnumerableOwnStringProperties,
} from "@tsonic/target-api";
import {
  acceptRustPolicy,
  rejectRustPolicy,
} from "../../policy/operations/contracts.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedCallSelectionResult,
  RustCheckedConversionSelectionInput,
  RustCheckedConversionSelectionResult,
  RustCheckedDeleteSelectionInput,
  RustCheckedElementSelectionInput,
  RustCheckedIterationSelectionInput,
  RustCheckedOperationSelectionResult,
  RustCheckedOperatorSelectionInput,
  RustCheckedPropertySelectionInput,
  RustCheckedValueSelectionInput,
  RustCheckedValueSelectionResult,
  RustOperationPolicyContext,
  RustPolicySelection,
  RustTargetOperationSelection,
} from "../../policy/operations/contracts.js";
import {
  rustArgumentPassingKey,
  rustRuntimeCarrierKey,
  rustSelectedCallKey,
  rustSelectedOperationKey,
} from "../../policy/model.js";
import type {
  RustTargetMember,
  TargetTypeRef,
} from "../../policy/types.js";
import {
  ElementAccessExpression_ArgumentExpression,
  KindArrayLiteralExpression,
  KindBigIntLiteral,
  KindCallExpression,
  KindNewExpression,
  KindNonNullExpression,
  KindParenthesizedExpression,
  KindPropertyAssignment,
  KindShorthandPropertyAssignment,
  KindSatisfiesExpression,
  Node_Expression,
  Node_Type,
  VariableDeclarationList_Declarations,
} from "../../common/source-ast.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import type {
  RustProviderOperationRow,
} from "../provider-packages/index.js";
import {
  rustFixedArrayCarrierValue,
  getRustJsMapTargetTypes,
  getRustJsSetElementTargetType,
  rustJsArrayTargetType,
  rustJsValueTargetType,
  rustJsErrorTargetType,
  rustOptionTargetType,
  rustCallableProtocol,
  rustSourceTypeCarrier,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
  rustCarrierSupportsClone,
  inferRustTargetTypeParameterBindings,
  rustTargetTypeContainsTypeParameter,
  substituteRustTargetTypeParameters,
} from "../rust-target-types.js";
import {
  isRustBigIntCarrier,
  isRustBoolCarrier,
  isRustCopyCarrier,
  getRustGeneratorProtocol,
  isRustJsArrayCarrier,
  isRustDefinitelyNullishCarrier,
  isRustProgramErrorCarrier,
  isRustNullishSourceCarrier,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustOptionElementCarrier,
  isRustSignedNumericCarrier,
} from "../rust-target-types.js";
import {
  rustTargetOperationResultCarrier,
  rustTargetOperationFactKey,
  rustPreparedOperationResultFactKey,
  rustOptionalChainFactKey,
  rustPostCheckBinaryOperationId,
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
  rustProjectDowncastFactKey,
  rustSourceCallableReturnFactKey,
} from "../rust-facts/keys.js";
import type {
  RustOperatorToken,
  RustProviderFactOperationKind,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustRuntimeSetOperationKind,
  RustTargetOperationFact,
} from "../rust-facts/keys.js";
import {
  rustInt32ToUsizeValueConversion,
  rustUsizeToInt32ValueConversion,
  selectRustSourceValueConversion,
  substituteRustValueConversion,
  rustValueConversionIsFallible,
  rustValueConversionIdentity,
} from "../rust-facts/value-conversions.js";
import {
  rustArgumentPassingMode,
} from "../rust-facts/parameter-passing.js";
import {
  finalizeRustProviderOperationAbi,
} from "../rust-facts/finalized-operation-abi.js";
import { isRustCVariadicArgumentCarrier } from "../rust-facts/c-variadic.js";
import { rustTargetOperationText } from "../rust-facts/target-operation.js";
import {
  selectJsSurfaceConstructorBySourceOwner,
  selectJsSurfaceOperation,
} from "./js-surface-operations.js";
import { finalizeRustCallbackOperation } from "./callback-operations.js";
import {
  asNode,
  isProjectSourceDeclaration,
  resolveSelectedJsSourceMember,
  resolveSelectedProviderDeclaration,
  resolveSelectedSourceProfileMember,
  resolveSelectedSourceProfilePropertyMembers,
} from "./selected-evidence.js";
import {
  selectRustProviderExport,
  selectRustProviderOperation,
} from "./provider-operation-selection.js";
import {
  resolveRustTargetTypeRef,
} from "./target-type-resolution.js";
import type { RustTargetTypeResolutionOptions } from "./target-type-resolution.js";
import {
  recordRustFlowReadProjection,
  selectRustFlowReadProjection,
} from "./value-carrier-reconciliation.js";
import {
  tsonicFixedArrayProviderMember,
  tsonicCoreSourceSemanticsModules,
} from "@tsonic/source-core";
import {
  rustSourceSemanticsModules,
} from "../rust-source-semantics/source-modules.js";
import type {
  RustSourceObjectField,
  RustSourceObjectShape,
  RustSourceTypeRegistry,
  RustSourceUnion,
} from "./source-type-registry.js";
import type { RustSourceProfileRegistry } from "./source-profile-registry.js";
import {
  selectedSourceLiteralIsRepresentable,
  selectedSourceNumericLiteralOperationId,
} from "./selected-numeric-literal.js";
import type { RustSourceCallableAbiResolver } from "./source-callable-abi.js";
import {
  selectRustTypedLocationCall,
} from "./typed-location-operations.js";
import {
  selectRustGeneratorSourceCall,
  selectRustGeneratorSourceProperty,
} from "./generator-source-profile.js";
import { rustProjectCallableTargetName } from "./source-member-name.js";
import {
  rustProjectObjectField,
  rustProjectObjectIndexSignature,
  rustProjectStaticFieldStorage,
} from "./project-object-layout.js";
import { selectRustOptionalChain } from "./optional-chains.js";
import type { RustProjectTypePolicy } from "./project-type-policy.js";
import { rustProviderGenericRequirementsAreSatisfied } from "./provider-generic-requirements.js";
import type { RustProjectMethodPropertyPlanRegistry } from "./project-method-properties.js";
import {
  recordRustValueCarrierReconciliation,
  rustEffectiveValueCarrier,
  selectRustValueCarrierReconciliation,
} from "./value-carrier-reconciliation.js";
import type {
  RustAppliedValueCarrierReconciliation,
} from "./value-carrier-reconciliation.js";

const sourceCallMarkerByIdentity = new Map(
  [
    ...tsonicCoreSourceSemanticsModules(),
    ...rustSourceSemanticsModules(),
  ].flatMap((module) =>
    module.exports
      .filter((declaration) => declaration.kind === "call-marker")
      .map((declaration) => [
        `${module.moduleSpecifier}::${declaration.exportName}`,
        declaration.marker,
      ] as const)),
);

export interface RustOperationsProviderOptions {
  readonly providerExports: readonly import("../provider-packages/index.js").RustProviderExportRow[];
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerTypes: readonly import("../provider-packages/index.js").RustProviderTypeRow[];
  readonly providerCarrierPaths: ReadonlyMap<string, string>;
  readonly jsEnabled: boolean;
  readonly regExpSubsetViolation: (pattern: string, flags: string) => string | undefined;
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly resolveProjectUnionCarrier: RustTargetTypeResolutionOptions["resolveProjectUnionCarrier"];
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
  readonly projectTypes: RustProjectTypePolicy;
  readonly projectMethodProperties: RustProjectMethodPropertyPlanRegistry;
}

export function selectRustCheckedOperator(
  request: RustCheckedOperatorSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  for (const sourceFile of context.sourceFiles) {
    if (sourceFile !== undefined) {
      options.sourceTypes.registerSourceFile(sourceFile, context.ast);
    }
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("operator");
  }
  if (request.operator === "instanceof") {
    return selectRustProjectTypeTest(request, context, options);
  }
  if (request.right !== undefined) {
    if (request.operator !== "=") {
      return acceptPostCheckOperator(request);
    }
    let left = resolveRustTargetTypeRef(request.left, context, options);
    let right = resolveRustTargetTypeRef(request.right, context, options);
    left = normalizeSelectedLiteralCarrier(request.left, left, right, context, options);
    right = normalizeSelectedLiteralCarrier(request.right, right, left, context, options);
    const selectedSet = mapSelectedAssignment(request, left, right, context, options);
    if (selectedSet !== undefined) {
      return selectedSet;
    }
    return acceptPostCheckOperator(request);
  }
  const operand = resolveRustTargetTypeRef(request.left, context, options);
  return mapSelectedUnaryOperator(request, operand, context);
}

function selectRustProjectTypeTest(
  request: RustCheckedOperatorSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const sourceCarrier = rustEffectiveValueCarrier(context.facts, request.left) ??
    resolveRustTargetTypeRef(request.left, context, options);
  const dispatchCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  const sourceDefinition = options.projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = options.projectTypes.definitionForDeclaration(request.sourceRightDeclaration);
  const targetCarrier = targetDefinition === undefined || targetDefinition.kind !== "class" ||
      targetDefinition.typeParameterNames.length !== 0
    ? undefined
    : options.projectTypes.openCarrier(targetDefinition);
  const programErrorVariant = targetDefinition === undefined
    ? undefined
    : options.projectTypes.programErrorVariant(targetDefinition);
  if (sourceCarrier !== undefined && isRustProgramErrorCarrier(sourceCarrier) &&
    targetCarrier !== undefined && programErrorVariant !== undefined) {
    const resultCarrier = rustSourcePrimitiveTargetType("bool");
    const fact: RustTargetOperationFact = {
      kind: "program-error-type-test",
      operationId: `tsonic.rust.program-error-type-test.${programErrorVariant}`,
      sourceCarrier,
      targetCarrier,
      variant: programErrorVariant,
      resultCarrier,
    };
    return acceptRustOperation(request.expression, fact, context, {
      sourceExpression: request.expression,
      sourceReceiver: request.left,
      sourceSelectedDeclaration: request.sourceRightDeclaration,
    }, resultCarrier);
  }
  if (sourceCarrier === undefined || dispatchCarrier === undefined || sourceDefinition === undefined ||
    targetDefinition === undefined || targetCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_TYPE_TEST_EVIDENCE_MISSING",
      "Checked instanceof requires exact project source, concrete class declaration, and closed target carrier evidence.",
    );
  }
  const sourceToTarget = options.projectTypes.relationship(dispatchCarrier, targetDefinition);
  let lowering: Extract<RustTargetOperationFact, { readonly kind: "project-type-test" }>["lowering"];
  if (sourceToTarget.kind === "related" && rustTargetTypeRefEquals(sourceToTarget.targetType, targetCarrier)) {
    lowering = rustOptionElementCarrier(sourceCarrier) === undefined
      ? { kind: "constant", value: true }
      : { kind: "option-presence" };
  } else {
    const targetToSource = options.projectTypes.relationship(targetCarrier, sourceDefinition);
    if (targetToSource.kind === "ambiguous" || sourceToTarget.kind === "ambiguous") {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_PROJECT_TYPE_TEST_AMBIGUOUS",
        "Checked instanceof has more than one exact project heritage instantiation.",
      );
    }
    if (targetToSource.kind === "related" &&
      rustTargetTypeRefEquals(targetToSource.targetType, dispatchCarrier)) {
      if (options.projectTypes.downcastRoute(sourceDefinition, targetCarrier) === undefined) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_PROJECT_TYPE_TEST_ROUTE_MISSING",
          "Checked instanceof requires one closed generated project downcast route.",
        );
      }
      lowering = { kind: "dispatch" };
    } else {
      lowering = { kind: "constant", value: false };
    }
  }
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  const fact: RustTargetOperationFact = {
    kind: "project-type-test",
    operationId: `tsonic.rust.project-type-test.${lowering.kind}`,
    sourceCarrier,
    dispatchCarrier,
    targetCarrier,
    resultCarrier,
    lowering,
  };
  return acceptRustOperation(request.expression, fact, context, {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    sourceSelectedDeclaration: request.sourceRightDeclaration,
  }, resultCarrier);
}

function acceptPostCheckOperator(
  request: RustCheckedOperatorSelectionInput,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const unaryOperationId = request.right === undefined
    ? request.operator === "-"
      ? rustPostCheckUnaryMinusOperationId
      : request.operator === "+"
        ? rustPostCheckUnaryPlusOperationId
        : undefined
    : undefined;
  const operationId = unaryOperationId ?? rustPostCheckBinaryOperationId;
  const provenance: NonNullable<RustTargetOperationSelection["provenance"]> = {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    ...(request.right === undefined ? {} : { sourceResultType: request.right }),
  };
  return acceptRustPolicy({
    operation: {
      operationId,
      operationKind: "operator",
      targetOperation: unaryOperationId === rustPostCheckUnaryMinusOperationId
        ? "-"
        : unaryOperationId === rustPostCheckUnaryPlusOperationId
          ? unaryOperationId
          : "post-check-finalization",
      provenance,
    },
    provenance,
  }, [{ message: "rust retained the TSTS-checked operator for post-check carrier finalization" }]);
}

function mapSelectedUnaryOperator(
  request: RustCheckedOperatorSelectionInput,
  operand: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const operandNode = asNode(request.left, context);
  if ((request.operator === "-" || request.operator === "+") &&
    operandNode !== undefined &&
    (context.ast.kindName(operandNode) === "KindNumericLiteral" ||
      context.ast.kindName(operandNode) === KindBigIntLiteral)) {
    return acceptPostCheckOperator(request);
  }
  let targetOperator: RustOperatorToken | undefined;
  let resultCarrier: TargetTypeRef | undefined;
  if (request.operator === "!" && isRustBoolCarrier(operand)) {
    targetOperator = "!";
    resultCarrier = operand;
  } else if (request.operator === "-" &&
    (isRustSignedNumericCarrier(operand) || isRustBigIntCarrier(operand))) {
    targetOperator = "-";
    resultCarrier = operand;
  } else if ((request.operator === "++" || request.operator === "--") &&
    (isRustNumericCarrier(operand) || isRustBigIntCarrier(operand))) {
    targetOperator = request.operator === "++" ? "+=" : "-=";
    resultCarrier = operand;
  } else if (request.operator === "+" && operand !== undefined && isRustNumericCarrier(operand)) {
    return acceptRustOperation(request.expression, {
      kind: "source-conversion",
      operationId: "tsonic.rust.operator.unary-plus",
      resultCarrier: operand,
    }, context, {
      sourceExpression: request.expression,
      sourceReceiver: request.left,
    });
  }
  if (targetOperator === undefined || resultCarrier === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_UNARY_OPERATOR_UNSUPPORTED", `Checked unary operator '${request.operator}' has no closed Rust operation for the selected operand carrier.`);
  }
  return acceptRustOperation(request.expression, operatorFact(targetOperator, resultCarrier), context, {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
  });
}

function mapSelectedAssignment(
  request: RustCheckedOperatorSelectionInput,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const selectedLeftFact = context.facts.resolve(request.left, rustTargetOperationFactKey);
  if (selectedLeftFact?.kind === "source-field" ||
    selectedLeftFact?.kind === "source-static-field" ||
    selectedLeftFact?.kind === "source-union-field" ||
    selectedLeftFact?.kind === "source-accessor") {
    return undefined;
  }
  const selectedLeft = context.facts.getSelectedTargetOperator(request.left);
  const selectedDeclaration = selectedLeft?.provenance?.sourceSelectedDeclaration;
  const selectedWriteDeclaration = selectedLeft?.provenance?.sourceSelectedWriteDeclaration;
  const providerWriteEvidence = resolveSelectedProviderDeclaration(
    context,
    selectedWriteDeclaration,
  );
  if (providerWriteEvidence.kind === "conflict") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_PROVIDER_WRITE_EVIDENCE_CONFLICT",
      "Checked assignment carries conflicting selected provider write-declaration identities.",
    );
  }
  const providerIdentity = providerWriteEvidence.kind === "selected"
    ? providerWriteEvidence.identity
    : selectedLeft?.provenance?.providerDeclaration;
  const jsIdentity = resolveSelectedJsSourceMember(context, selectedDeclaration, options.sourceProfiles);
  const receiver = selectedLeft?.provenance?.sourceReceiver;
  const receiverCarrier = resolveRustTargetTypeRef(receiver, context, options);
  const operationKind = selectedLeft?.operationKind === "property"
    ? "property-set"
    : selectedLeft?.operationKind === "indexer"
      ? "index-set"
      : undefined;
  if (operationKind === undefined) {
    return undefined;
  }
  if (providerIdentity !== undefined) {
    const providerSelection = mapSelectedProviderAssignment(
      request,
      right,
      providerIdentity,
      operationKind,
      receiver,
      selectedWriteDeclaration ?? selectedDeclaration,
      receiverCarrier,
      context,
      options,
    );
    if (providerSelection !== undefined) {
      return providerSelection;
    }
  }
  if (receiverCarrier === undefined) {
    return jsIdentity !== undefined && options.jsEnabled
      ? rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_EVIDENCE_MISSING", "Selected JavaScript assignment has no closed receiver carrier in its finalized operation evidence.")
      : undefined;
  }
  if (jsIdentity === undefined || !options.jsEnabled) {
    return undefined;
  }
  const leftNode = asNode(request.left, context);
  const indexNode = operationKind === "index-set" && leftNode !== undefined
    ? ElementAccessExpression_ArgumentExpression(context.ast, leftNode)
    : undefined;
  const assignmentSubjects = operationKind === "index-set"
    ? indexNode === undefined || request.right === undefined ? undefined : [indexNode, request.right]
    : request.right === undefined ? undefined : [request.right];
  if (assignmentSubjects === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_EVIDENCE_MISSING", "Selected JavaScript assignment has no closed index/value source evidence.");
  }
  const selection = selectJsSurfaceOperation({
    ownerName: jsIdentity.ownerName,
    memberName: jsIdentity.memberName,
    operationKind,
    receiverCarrier,
    argumentCarriers: assignmentSubjects.map((subject) =>
      resolveRustTargetTypeRef(subject, context, options)),
    argumentCompatibility: selectedArgumentCompatibility(assignmentSubjects, context, options),
  });
  if (selection === undefined || selection.fact.kind !== "runtime-set") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_UNSUPPORTED", `The selected JavaScript assignment '${jsIdentity.ownerName}.${jsIdentity.memberName}' has no closed Rust setter operation.`);
  }
  const valueIndex = operationKind === "index-set" ? 1 : 0;
  const valueCarrier = selection.parameterCarriers?.[valueIndex];
  const selectedRight = normalizeSelectedLiteralCarrier(request.right, right, valueCarrier, context, options);
  if (valueCarrier === undefined || selectedRight === undefined ||
    !rustTargetTypeRefEquals(valueCarrier, selectedRight)) {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_VALUE_MISMATCH", "The selected JavaScript setter value does not match its finalized Rust carrier.");
  }
  const sourceArgumentCarriers: TargetTypeRef[] = [];
  if (operationKind === "index-set") {
    const expectedIndex = selection.parameterCarriers?.[0];
    const selectedIndex = indexNode === undefined
      ? undefined
      : normalizeSelectedLiteralCarrier(
          indexNode,
          resolveRustTargetTypeRef(indexNode, context, options),
          expectedIndex,
          context,
          options,
        );
    if (expectedIndex === undefined || selectedIndex === undefined ||
      !rustTargetTypeRefEquals(expectedIndex, selectedIndex)) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_INDEX_MISMATCH", "The selected JavaScript index setter has no closed source index carrier.");
    }
    sourceArgumentCarriers.push(selectedIndex);
  }
  sourceArgumentCarriers.push(selectedRight);
  const abi = finalizeRustProviderOperationAbi({
    operationKind,
    form: selection.fact.target,
    sourceReceiverCarrier: receiverCarrier,
    sourceArgumentCarriers,
    declaredSourceArgumentCarriers: selection.parameterCarriers,
    resultCarrier: rustUnitTargetType(),
    isAsync: false,
    isFallible: false,
  });
  if (abi === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_ABI_INCOMPLETE", "The selected JavaScript setter cannot finalize one total Rust operation ABI.");
  }
  return acceptRustOperation(request.expression, {
    kind: "runtime-set",
    operationId: selection.fact.operationId,
    abi,
  }, context, {
    sourceExpression: request.expression,
    sourceReceiver: receiver,
    sourceSelectedDeclaration: selectedDeclaration,
    sourceResultType: request.right,
  }, selectedRight ?? left);
}

function mapSelectedProviderAssignment(
  request: RustCheckedOperatorSelectionInput,
  right: TargetTypeRef | undefined,
  identity: ProviderDeclarationIdentity,
  operationKind: RustRuntimeSetOperationKind,
  receiver: ExtensionFactSubject | undefined,
  selectedDeclaration: ExtensionFactSubject | undefined,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const selection = selectRustProviderOperation(options.providerRows, identity, operationKind);
  if (selection.kind === "missing") {
    return undefined;
  }
  if (selection.kind === "ambiguous") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROVIDER_SET_OPERATION_AMBIGUOUS",
      `Selected provider declaration '${providerIdentityText(identity)}' matches ${selection.rows.length} Rust ${operationKind} rows.`,
    );
  }
  const leftNode = asNode(request.left, context);
  const indexNode = operationKind === "index-set" && leftNode !== undefined
    ? ElementAccessExpression_ArgumentExpression(context.ast, leftNode)
    : undefined;
  const sourceArguments = operationKind === "index-set"
    ? indexNode === undefined || request.right === undefined ? undefined : [indexNode, request.right]
    : request.right === undefined ? undefined : [request.right];
  if (sourceArguments === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROVIDER_SET_EVIDENCE_MISSING",
      "Selected provider setter has no exact source index/value evidence.",
    );
  }
  const rawArgumentCarriers = sourceArguments.map((argument) =>
    resolveRustTargetTypeRef(argument, context, options));
  const instantiation = instantiateProviderOperationTemplate(
    providerOperationTemplate(selection.row, operationKind),
    {
      ...(receiverCarrier === undefined ? {} : { sourceReceiverCarrier: receiverCarrier }),
      sourceParameterCarriers: rawArgumentCarriers,
    },
  );
  const template = instantiation?.template;
  if (template !== undefined && providerFormRequiresSourceReceiver(template.target) && receiverCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROVIDER_SET_EVIDENCE_MISSING",
      `Selected provider declaration '${providerIdentityText(identity)}' requires a closed source receiver carrier for its Rust ${operationKind} operation.`,
    );
  }
  if (template === undefined || template.parameterCarriers === undefined ||
    template.parameterCarriers.length !== sourceArguments.length) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROVIDER_SET_ABI_INCOMPLETE",
      `Selected provider declaration '${providerIdentityText(identity)}' cannot instantiate one total Rust ${operationKind} ABI.`,
    );
  }
  const sourceArgumentCarriers = sourceArguments.map((argument, index) =>
    normalizeSelectedOperationInputCarrier(
      argument,
      rawArgumentCarriers[index],
      template.parameterCarriers?.[index],
      context,
      options,
    ));
  const finalizedSourceArgumentCarriers = sourceArgumentCarriers.filter(
    (carrier): carrier is TargetTypeRef => carrier !== undefined,
  );
  if (finalizedSourceArgumentCarriers.length !== sourceArgumentCarriers.length ||
    finalizedSourceArgumentCarriers.some((carrier, index) =>
      !rustTargetTypeRefEquals(carrier, template.parameterCarriers?.[index]))) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROVIDER_SET_VALUE_MISMATCH",
      `Selected provider declaration '${providerIdentityText(identity)}' has source inputs that do not match its finalized Rust ${operationKind} carriers.`,
    );
  }
  const abi = finalizeRustProviderOperationAbi({
    operationKind,
    form: template.target,
    ...(receiverCarrier === undefined ? {} : { sourceReceiverCarrier: receiverCarrier }),
    sourceArgumentCarriers: finalizedSourceArgumentCarriers,
    declaredSourceArgumentCarriers: template.parameterCarriers,
    resultCarrier: template.resultCarrier,
    isAsync: template.isAsync,
    isFallible: template.isFallible,
    ...(template.errorBoundary === "none" ? {} : { errorBoundary: template.errorBoundary }),
    isUnsafe: template.isUnsafe,
  });
  if (abi === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROVIDER_SET_ABI_INCOMPLETE",
      `Selected provider declaration '${providerIdentityText(identity)}' cannot finalize one total Rust ${operationKind} ABI.`,
    );
  }
  const selectedRight = finalizedSourceArgumentCarriers[finalizedSourceArgumentCarriers.length - 1];
  const sourceResultCarrier = context.facts.getRuntimeCarrierFact(request.right)?.carrier ?? right;
  return acceptRustOperation(request.expression, {
    kind: "runtime-set",
    operationId: template.operationId,
    abi,
  }, context, {
    sourceExpression: request.expression,
    sourceReceiver: receiver,
    sourceSelectedDeclaration: selectedDeclaration,
    sourceResultType: request.right,
    providerDeclaration: identity,
  }, sourceResultCarrier ?? selectedRight);
}

function operatorFact(operator: RustOperatorToken, resultCarrier: TargetTypeRef): Extract<RustTargetOperationFact, { readonly kind: "operator-token" }> {
  return {
    kind: "operator-token",
    operationId: `tsonic.rust.operator.${operator}.${rustCarrierIdentity(resultCarrier)}`,
    operator,
    resultCarrier,
  };
}

function rustCarrierIdentity(carrier: TargetTypeRef): string {
  if (carrier.kind === "source-primitive") {
    return carrier.name;
  }
  if (carrier.kind === "target-named") {
    return carrier.id;
  }
  return carrier.kind;
}

function selectedCallArgumentNodes(
  request: RustCheckedCallSelectionInput,
): readonly Node[] {
  return request.source.sourceArguments.map((argument) => argument.expression);
}

function selectedCallArgumentCarriers(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly (TargetTypeRef | undefined)[] {
  return request.source.sourceArguments.map((argument) =>
    selectedSourceValueCarrier(argument, context, options));
}

function selectedSourceValueCarrier(
  value: RustCheckedCallSelectionInput["source"]["sourceArguments"][number],
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  return selectedValueCarrier(value.expression, value.type, context, options);
}

function selectedValueCarrier(
  expression: ExtensionFactSubject,
  selectedType: ExtensionFactSubject,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const stored = resolveRustTargetTypeRef(expression, context, options);
  const effective = rustEffectiveValueCarrier(context.facts, expression);
  if (effective !== undefined &&
    (stored === undefined || !rustTargetTypeRefEquals(effective, stored))) {
    return effective;
  }
  const selected = resolveRustTargetTypeRef(selectedType, context, options);
  if (stored === undefined || selected === undefined ||
    rustTargetTypeRefEquals(stored, selected)) {
    return selected ?? stored;
  }
  const optionalElement = rustOptionElementCarrier(stored);
  if (optionalElement !== undefined &&
    rustTargetTypeRefEquals(optionalElement, selected)) {
    return selected;
  }
  const sourceDefinition = options.projectTypes.definitionForCarrier(
    optionalElement ?? stored,
  );
  return sourceDefinition !== undefined &&
      options.projectTypes.downcastRoute(sourceDefinition, selected) !== undefined
    ? selected
    : stored;
}

function selectedCallCalleeSymbol(
  request: RustCheckedCallSelectionInput,
): import("@tsonic/tsts").Symbol | undefined {
  return request.source.sourceCallee.selectedSymbol ??
    request.source.sourceCallee.symbol;
}

function selectedCallCalleeDeclaration(
  request: RustCheckedCallSelectionInput,
): Node | undefined {
  return request.source.sourceCallee.selectedDeclaration ??
    request.source.sourceCallee.declaration;
}

export function selectRustCheckedCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.source.selectedSignature, precision: "exact" },
      { subject: selectedCallCalleeDeclaration(request), precision: "declaration" },
      { subject: selectedCallCalleeSymbol(request), precision: "declaration" },
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked call carries conflicting selected provider declaration identities.");
  }
  if (providerEvidence.kind === "selected") {
    const provider = providerEvidence.identity;
    const sourceMarker = provider.exportId === undefined
      ? undefined
      : sourceCallMarkerByIdentity.get(`${provider.moduleSpecifier}::${provider.exportId}`);
    if (sourceMarker !== undefined) {
      return mapRustSourceMarkerCall(request, provider, sourceMarker, context, options);
    }
    const operationKind = checkedCallIsConstruction(request, context) ? "constructor" : "method";
    const selection = selectRustProviderOperation(options.providerRows, provider, operationKind);
    if (selection.kind === "missing") {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_OPERATION_NOT_MAPPED", `No Rust operation row matches selected provider declaration '${providerIdentityText(provider)}' as ${operationKind}.`);
    }
    if (selection.kind === "ambiguous") {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_OPERATION_AMBIGUOUS", `Selected provider declaration '${providerIdentityText(provider)}' matches ${selection.rows.length} Rust operation rows.`);
    }
    const instantiation = instantiateSelectedCallTemplate(
      request,
      providerOperationFact(selection.row),
      context,
      options,
    );
    if (instantiation === undefined) {
      return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_TYPE_INSTANTIATION_NOT_PROVEN", `Selected call '${provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier}' does not prove one closed instantiation of its Rust provider type parameters.`);
    }
    if (selection.row.immediateCallback !== undefined) {
      return acceptRustPolicy({
        kind: "deferred-callback",
        callback: {
          shape: "direct",
          sourceArgumentIndex: selection.row.immediateCallback.sourceArgumentIndex,
          fallibleTarget: substituteProviderOperationForm(
            selection.row.immediateCallback.fallibleTarget,
            instantiation.substitutions,
          ),
        },
        sourceName: provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier,
        providerDeclaration: provider,
        template: instantiation.template,
        parameterCarriers: instantiation.template.parameterCarriers ?? [],
      });
    }
    return acceptSelectedCall(request, instantiation.template, instantiation.template.parameterCarriers, context, options, {
      sourceName: provider.memberName ?? provider.exportName ?? provider.exportId ?? provider.moduleSpecifier,
      providerDeclaration: provider,
    });
  }

  const selectedSourceMember = resolveSelectedSourceProfileMember(
    context,
    request.sourceSelectedDeclaration,
    options.sourceProfiles,
  );
  const calleeSourceMember = resolveSelectedSourceProfileMember(
    context,
    selectedCallCalleeDeclaration(request),
    options.sourceProfiles,
  );
  if (selectedSourceMember === undefined && calleeSourceMember !== undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_SOURCE_DECLARATION_MISSING", "Checked source-profile call has callee evidence but no exact selected declaration evidence.");
  }
  if (selectedSourceMember !== undefined && calleeSourceMember !== undefined &&
    (selectedSourceMember.profile !== calleeSourceMember.profile ||
      selectedSourceMember.ownerName !== calleeSourceMember.ownerName ||
      selectedSourceMember.memberName !== calleeSourceMember.memberName)) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_SOURCE_EVIDENCE_CONFLICT", "Checked source-profile call carries conflicting selected and callee declaration identities.");
  }
  if (selectedSourceMember?.ownerName === "ErrorConstructor" &&
    selectedSourceMember.memberName === "constructor" && checkedCallIsConstruction(request, context)) {
    if (selectedCallArgumentNodes(request).length !== 1) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_ERROR_MESSAGE_REQUIRED",
        "Rust Error construction currently requires one checked string message argument.",
      );
    }
    const resultCarrier = rustJsErrorTargetType();
    return acceptSelectedCall(request, {
      kind: "provider-operation",
      operationId: "tsonic.rust.error.constructor",
      operationKind: "constructor",
      target: { form: "call", path: "rt::JsError::error", argModes: ["ref"] },
      parameterCarriers: [rustStringTargetType()],
      resultCarrier,
      isAsync: false,
      isFallible: false,
      errorBoundary: "none",
    }, [rustStringTargetType()], context, options, {
      sourceName: "Error",
    });
  }
  if (selectedSourceMember !== undefined) {
    const receiverCarrier = selectedCallReceiverValueCarrier(
      request,
      context,
      options,
    );
    const generator = selectRustGeneratorSourceCall({
      ownerName: selectedSourceMember.ownerName,
      memberName: selectedSourceMember.memberName,
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      selectedParameterCount: request.source.sourceSelectedSignatureParameters.length,
      argumentCarriers: selectedCallArgumentCarriers(request, context, options),
    });
    if (generator.kind === "rejected") {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_GENERATOR_SOURCE_CALL_NOT_CLOSED",
        generator.message,
      );
    }
    if (generator.kind === "resolved") {
      return acceptSelectedCall(
        request,
        generator.template,
        generator.parameterCarriers,
        context,
        options,
        { sourceName: selectedSourceMember.memberName },
      );
    }
  }
  if (selectedSourceMember?.profile === "js") {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.source.call, context, "RUST_JS_SURFACE_REQUIRED", "The selected call belongs to the explicit JavaScript source profile, which is not active.");
    }
    if (checkedCallIsConstruction(request, context)) {
      if (selectedSourceMember.ownerName === "RegExpConstructor") {
        return mapSelectedRegExpConstruction(request, context, options);
      }
      const typeArgumentCarriers = (request.source.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
        resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, options));
      const argumentCarriers = selectedCallArgumentCarriers(request, context, options);
      const selection = selectJsSurfaceConstructorBySourceOwner({
        sourceOwnerName: selectedSourceMember.ownerName,
        typeArgumentCarriers,
        argumentCarriers,
      });
      if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
        return rejectSelectedOperation(
          request.source.call,
          context,
          "RUST_SELECTED_OPERATION_UNSUPPORTED",
          `The selected JavaScript constructor '${selectedSourceMember.ownerName}' has no closed Rust operation row for the selected argument carriers.`,
          [{
            message: `arguments=${JSON.stringify(argumentCarriers)}; selectedTypeArguments=${JSON.stringify(typeArgumentCarriers)}`,
          }],
        );
      }
      return acceptSelectedCall(request, selection.fact, selection.parameterCarriers ?? [], context, options, {
        sourceName: selectedSourceMember.ownerName,
      });
    }
    const receiverCarrier = selectedCallReceiverValueCarrier(
      request,
      context,
      options,
    );
    const argumentCarriers = selectedCallArgumentCarriers(request, context, options);
    const selectedMethodTypeArgumentCarriers =
      (request.source.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
        resolveRustTargetTypeRef(
          argument.explicitTypeNode ?? argument.selectedType,
          context,
          options,
        ));
    const authoredMethodTypeArgumentCarriers =
      (request.source.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
        argument.explicitTypeNode === undefined
          ? undefined
          : resolveRustTargetTypeRef(argument.explicitTypeNode, context, options));
    const special = mapSelectedJsSpecialCall(
      request,
      selectedSourceMember.ownerName,
      selectedSourceMember.memberName,
      context,
      options,
    );
    if (special !== undefined) {
      return special;
    }
    const selection = selectJsSurfaceOperation({
      ownerName: selectedSourceMember.ownerName,
      memberName: selectedSourceMember.memberName,
      operationKind: "call",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      ...(argumentCarriers.length === 0 ? {} : { argumentCarriers }),
      selectedMethodTypeArgumentCarriers,
      authoredMethodTypeArgumentCarriers,
      argumentCompatibility: selectedArgumentCompatibility(selectedCallArgumentNodes(request), context, options),
      carrierSupportsProjectIdentity: (carrier) =>
        options.projectTypes.definitionForCarrier(carrier) !== undefined,
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_OPERATION_UNSUPPORTED",
        `The selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no closed Rust operation row for the selected receiver and argument carriers.`,
        [{
          message: `receiver=${JSON.stringify(receiverCarrier)}; arguments=${JSON.stringify(argumentCarriers)}; selectedTypeArguments=${JSON.stringify(selectedMethodTypeArgumentCarriers)}; authoredTypeArguments=${JSON.stringify(authoredMethodTypeArgumentCarriers)}`,
        }],
      );
    }
    if (selection.callback !== undefined) {
      return selection.fact.kind !== "provider-operation"
        ? rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_CALLBACK_CARRIER_MISSING", `Selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no provider operation template.`)
        : acceptRustPolicy({
            kind: "deferred-callback",
            callback: selection.callback,
            sourceName: selectedSourceMember.memberName,
            template: selection.fact,
            parameterCarriers: selection.parameterCarriers ?? [],
          });
    }
    return acceptSelectedCall(request, selection.fact, selection.parameterCarriers, context, options, {
      sourceName: selectedSourceMember.memberName,
    });
  }

  const sourceDeclaration = isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)
    ? asNode(request.sourceSelectedDeclaration, context)
    : undefined;
  const calleeDeclaration = isProjectSourceDeclaration(context, selectedCallCalleeDeclaration(request))
    ? asNode(selectedCallCalleeDeclaration(request), context)
    : undefined;
  const implicitConstructorClass = sourceDeclaration === undefined &&
      calleeDeclaration !== undefined &&
      checkedCallIsConstruction(request, context) &&
      context.ast.kindName(calleeDeclaration) === "KindClassDeclaration"
    ? calleeDeclaration
    : sourceDeclaration === undefined
      ? selectedImplicitSuperConstructorClass(request, context, options)
      : undefined;
  if (implicitConstructorClass !== undefined) {
    return acceptProjectSourceCall(request, implicitConstructorClass, context, options);
  }
  if (sourceDeclaration === undefined && calleeDeclaration !== undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_PROJECT_DECLARATION_MISSING", "Checked project-source call has callee evidence but no exact selected callable declaration evidence.");
  }
  if (sourceDeclaration !== undefined) {
    return acceptProjectSourceCall(request, sourceDeclaration, context, options);
  }

  return rejectSelectedOperation(
    request.source.call,
    context,
    "RUST_SELECTED_CALL_EVIDENCE_MISSING",
    "Checked call has no exact provider, source-profile, or project-source selection that Rust can lower.",
  );
}

function selectedImplicitSuperConstructorClass(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): Node | undefined {
  if (context.ast.kindName(request.source.sourceCallee.expression) !== "KindSuperKeyword") {
    return undefined;
  }
  const containing = options.projectTypes.definitionContainingDeclaration(
    request.source.call,
  );
  if (containing?.kind !== "class") {
    return undefined;
  }
  const matches = options.projectTypes.heritageForDefinition(containing).filter((edge) =>
    edge.kind === "extends" &&
    edge.target.kind === "class" &&
    options.projectTypes.constructorForSignature(
      edge.target,
      request.source.selectedSignature,
    ) !== undefined);
  return matches.length === 1 ? matches[0]!.target.declaration : undefined;
}

export interface RustPreparedDeferredCheckedCall {
  readonly sourceName: string;
  readonly providerDeclaration?: ProviderDeclarationIdentity;
  readonly callback: import("../rust-facts/keys.js").RustCallbackOperationTemplate;
  readonly template: RustProviderOperationTemplate;
  readonly parameterCarriers: readonly TargetTypeRef[];
  readonly resultCarrier: TargetTypeRef;
}

export function prepareRustDeferredCheckedCall(
  request: RustCheckedCallSelectionInput,
  deferred: Extract<
    RustCheckedCallSelectionResult,
    { readonly kind: "deferred-callback" }
  >,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  resolveArgument: (
    argument: Node,
    expected: TargetTypeRef | undefined,
  ) => TargetTypeRef | undefined,
): RustPolicySelection<RustPreparedDeferredCheckedCall> {
  const arguments_ = selectedCallArgumentNodes(request);
  if (arguments_.length !== deferred.parameterCarriers.length) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CALLBACK_ARITY_MISMATCH",
      `Selected callback call '${deferred.sourceName}' has ${arguments_.length} source arguments but ${deferred.parameterCarriers.length} target parameters.`,
    );
  }
  const actual: (TargetTypeRef | undefined)[] = new Array(arguments_.length);
  if (deferred.callback.shape === "reduce") {
    const accumulatorIndex = deferred.callback.accumulatorArgumentIndex;
    const accumulatorArgument = accumulatorIndex === undefined
      ? undefined
      : arguments_[accumulatorIndex];
    if (accumulatorArgument === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_CALLBACK_ACCUMULATOR_MISSING",
        "Selected reduce call has no exact accumulator source argument.",
      );
    }
    const accumulatorExpectation = accumulatorIndex === undefined
      ? undefined
      : deferred.parameterCarriers[accumulatorIndex];
    const accumulator = resolveArgument(
      accumulatorArgument,
      accumulatorExpectation,
    );
    if (accumulator === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_CALLBACK_ACCUMULATOR_CARRIER_MISSING",
        "Selected reduce call has no closed target carrier for its exact accumulator argument.",
      );
    }
    actual[accumulatorIndex!] = accumulator;
    const callbackArgument = arguments_[deferred.callback.sourceArgumentIndex];
    const callbackTemplate = deferred.parameterCarriers[deferred.callback.sourceArgumentIndex];
    if (callbackArgument === undefined || callbackTemplate === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_CALLBACK_CARRIER_MISSING",
        "Selected reduce call has no exact callback argument or callback target template.",
      );
    }
    actual[deferred.callback.sourceArgumentIndex] = resolveArgument(
      callbackArgument,
      replaceRustInferCarrier(callbackTemplate, accumulator),
    );
  } else {
    for (const [index, argument] of arguments_.entries()) {
      actual[index] = resolveArgument(
        argument,
        deferred.parameterCarriers[index],
      );
    }
  }
  if (actual.some((carrier) => carrier === undefined)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CALLBACK_CARRIER_MISSING",
      `Selected callback call '${deferred.sourceName}' has no closed callback/result carrier from exact target analysis.`,
    );
  }
  const finalized = finalizeRustCallbackOperation({
    fact: deferred.template,
    parameterCarriers: deferred.parameterCarriers,
    callback: deferred.callback,
  }, actual as TargetTypeRef[]);
  if (finalized?.fact.kind !== "provider-operation") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CALLBACK_CARRIER_CONFLICT",
      `Selected callback call '${deferred.sourceName}' has callback argument carriers incompatible with its exact target operation row.`,
    );
  }
  const parameterCarriers = finalized.parameterCarriers;
  if (parameterCarriers === undefined || parameterCarriers.some((carrier) => carrier === undefined)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CALLBACK_PARAMETER_CARRIER_MISSING",
      `Selected callback call '${deferred.sourceName}' did not finalize every callback parameter carrier.`,
    );
  }
  const optionalResult = selectRustOptionalCallResult(
    request,
    finalized.fact.resultCarrier,
    context,
    options,
  );
  if (optionalResult.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OPTIONAL_CALL_CONTRACT_INVALID",
      optionalResult.message,
    );
  }
  return acceptRustPolicy({
    sourceName: deferred.sourceName,
    ...(deferred.providerDeclaration === undefined
      ? {}
      : { providerDeclaration: deferred.providerDeclaration }),
    callback: deferred.callback,
    template: finalized.fact,
    parameterCarriers: parameterCarriers as readonly TargetTypeRef[],
    resultCarrier: optionalResult.resultCarrier,
  });
}

export function finalizeRustPreparedCheckedCall(
  request: RustCheckedCallSelectionInput,
  prepared: RustPreparedDeferredCheckedCall,
  callbackFallible: boolean,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const template = callbackFallible
    ? {
        ...prepared.template,
        target: prepared.callback.fallibleTarget,
        isFallible: true,
        errorBoundary: "source-program" as const,
      }
    : prepared.template;
  return acceptSelectedCall(
    request,
    template,
    prepared.parameterCarriers,
    context,
    options,
    {
      sourceName: prepared.sourceName,
      ...(prepared.providerDeclaration === undefined
        ? {}
        : { providerDeclaration: prepared.providerDeclaration }),
    },
  );
}

function replaceRustInferCarrier(
  template: TargetTypeRef,
  replacement: TargetTypeRef,
): TargetTypeRef {
  if (template.kind === "opaque" && template.id === "tsonic.rust.infer") {
    return replacement;
  }
  if (template.kind === "function-pointer" || template.kind === "closure") {
    return {
      ...template,
      args: template.args.map((argument) =>
        replaceRustInferCarrier(argument, replacement)),
      result: replaceRustInferCarrier(template.result, replacement),
    };
  }
  return template;
}

function mapRustSourceMarkerCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  markerName: SourceCallMarkerKind,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  if (markerName === "default-value") {
    return mapRustDefaultValueCall(request, provider, context, options);
  }
  const typedLocation = selectRustTypedLocationCall(
    request,
    provider,
    markerName,
    context,
    options,
  );
  if (typedLocation !== undefined) {
    return typedLocation;
  }
  if (
    markerName !== "shared-borrow" &&
    markerName !== "mutable-borrow" &&
    markerName !== "move"
  ) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SOURCE_MARKER_UNSUPPORTED",
      `Rust does not support selected source marker '${markerName}' in this operation lane.`,
    );
  }
  const flow = context.facts.resolve(request.source.call, flowStateFactKey) ??
    context.facts.get(request.source.call, flowStateFactKey);
  const expectedState = markerName === "shared-borrow"
    ? "borrowed-shared"
    : markerName === "mutable-borrow" ? "borrowed-mut" : "moved";
  if (flow?.state !== expectedState) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_FLOW_MARKER_FACT_NOT_PROVEN",
      `Selected Rust flow marker '${markerName}' requires finalized TSTS flow state '${expectedState}'.`,
    );
  }
  const [argument] = selectedCallArgumentNodes(request);
  const carrier = resolveRustTargetTypeRef(request.source.sourceResultType ?? argument, context, options) ??
    resolveRustTargetTypeRef(argument, context, options);
  if (argument === undefined || carrier === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_FLOW_MARKER_CARRIER_NOT_PROVEN",
      `Selected Rust flow marker '${markerName}' has no closed target carrier from TSTS evidence.`,
    );
  }
  const fact: RustTargetOperationFact = {
    kind: "flow-marker",
    operationId: `tsonic.rust.flow.${expectedState}`,
    state: expectedState,
  };
  const evidence = [{ message: `rust selected flow marker ${markerName}` }];
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  return acceptRustPolicy({
    selectedSignature: {
      member: {
        id: fact.operationId,
        sourceName: markerName,
        targetName: "marker",
        kind: "method",
        parameters: [{ name: "value", type: carrier, passingMode: "by-value" }],
        returnType: carrier,
        providerDeclaration: provider,
      },
      providerDeclaration: provider,
      ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
      ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
      ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
      sourceArgumentBindings: request.source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    },
  }, evidence);
}

function mapRustDefaultValueCall(
  request: RustCheckedCallSelectionInput,
  provider: ProviderDeclarationIdentity,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const sourceArguments = selectedCallArgumentNodes(request);
  const sourceFact = context.facts.resolve(request.source.call, defaultValueFactKey) ??
    context.facts.get(request.source.call, defaultValueFactKey);
  const resultCarrier = resolveRustTargetTypeRef(sourceFact?.type, context, options);
  const sourceTypeArguments = request.source.sourceSelectedMethodTypeArguments;
  const targetTypeArguments = mapSelectedTargetTypeArguments(request, context, options);
  if (sourceArguments.length !== 0 || sourceFact === undefined || resultCarrier === undefined ||
    sourceTypeArguments?.length !== 1 ||
    targetTypeArguments === undefined || targetTypeArguments.length !== 1 ||
    !rustTargetTypeRefEquals(targetTypeArguments[0], resultCarrier)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_DEFAULT_VALUE_EVIDENCE_NOT_PROVEN",
      "defaultValue<T>() requires one exact source-core type fact, one matching selected type argument, no arguments, and one matching Rust result carrier.",
    );
  }
  const operationId = "tsonic.rust.default-value";
  const fact: Extract<RustTargetOperationFact, { readonly kind: "default-value" }> = {
    kind: "default-value",
    operationId,
    resultCarrier,
  };
  const operation: RustTargetOperationSelection = {
    operationId,
    operationKind: "method",
    targetOperation: "Default::default",
    resultType: resultCarrier,
    providerDeclaration: provider,
    provenance: {
      sourceExpression: request.source.call,
      sourceCallee: request.source.sourceCallee.expression,
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: selectedCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
      providerDeclaration: provider,
    },
  };
  const member: RustTargetMember = {
    id: operationId,
    sourceName: "defaultValue",
    targetName: "Default::default",
    kind: "method",
    static: true,
    parameters: [],
    returnType: resultCarrier,
    typeParameters: [{ name: sourceTypeArguments[0]!.typeParameterName }],
    providerDeclaration: provider,
  };
  const selectedSignature = {
    member,
    providerDeclaration: provider,
    targetTypeArguments,
    ...(request.source.selectedSignature === undefined
      ? {}
      : { sourceSignature: request.source.selectedSignature }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceDeclaration: request.sourceSelectedDeclaration }),
    ...(selectedCallCalleeSymbol(request) === undefined
      ? {}
      : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
    ...(selectedCallCalleeDeclaration(request) === undefined
      ? {}
      : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
    ...(request.source.sourceResultType === undefined
      ? {}
      : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    sourceSelectedMethodTypeArguments: sourceTypeArguments,
  };
  const evidence = [{ message: "rust selected source-core defaultValue<T>()" }];
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  context.facts.set(request.source.call, rustSelectedOperationKey, operation, evidence);
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}

export function selectRustCheckedValue(
  request: RustCheckedValueSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedValueSelectionResult> {
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.sourceSelectedSymbol, precision: "exact" },
      { subject: request.expression, precision: "exact" },
    ],
  );
  if (providerEvidence.kind === "missing") {
    return acceptRustPolicy({ kind: "source" }, [
      { message: "rust source value has no selected provider declaration" },
    ]);
  }
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT",
      "Checked value carries conflicting selected provider declaration identities.",
    );
  }
  const providerExport = selectRustProviderExport(
    options.providerExports,
    providerEvidence.identity,
  );
  if (providerExport.kind === "missing") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_PROVIDER_EXPORT_MISSING",
      "Checked provider value evidence has no matching Rust provider export declaration.",
    );
  }
  if (providerExport.kind === "ambiguous") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_PROVIDER_EXPORT_AMBIGUOUS",
      "Checked provider value evidence matches more than one Rust provider export declaration.",
    );
  }
  if (providerExport.row.declarationKind !== "value") {
    return acceptRustPolicy({ kind: "source" }, [
      { message: `rust selected provider export is ${providerExport.row.declarationKind}, not a direct value` },
    ]);
  }
  return mapProviderCheckedOperation(
    request.expression,
    providerEvidence.identity,
    "property",
    context,
    options,
    undefined,
    [],
  );
}

function mapSelectedRegExpConstruction(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const [patternNode, flagsNode] = selectedCallArgumentNodes(request).map((argument) => asNode(argument, context));
  const ast = context.ast;
  const pattern = patternNode !== undefined && ast.kindName(patternNode) === "KindStringLiteral"
    ? ast.text(patternNode)
    : undefined;
  const flags = flagsNode === undefined
    ? ""
    : ast.kindName(flagsNode) === "KindStringLiteral" ? ast.text(flagsNode) : undefined;
  if (pattern === undefined || flags === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_REGEXP_DYNAMIC_UNSUPPORTED", "Rust RegExp construction requires TSTS-selected RegExp constructor evidence and compile-time string pattern/flags.");
  }
  const violation = options.regExpSubsetViolation(pattern, flags);
  if (violation !== undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_REGEXP_UNSUPPORTED", violation);
  }
  const resultCarrier: TargetTypeRef = { kind: "target-named", id: "rust.js.JsRegExp" };
  const fact: RustTargetOperationFact = {
    kind: "regexp-create",
    operationId: "tsonic.rust.js.regexp.create",
    pattern,
    flags,
  };
  const evidence = [{ message: "rust selected RegExp constructor" }];
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  context.facts.set(request.source.call, rustSelectedOperationKey, {
    operationId: fact.operationId,
    operationKind: "constructor",
    targetOperation: "js_abi::JsRegExp::new",
    resultType: resultCarrier,
    provenance: {
      sourceExpression: request.source.call,
      sourceCallee: request.source.sourceCallee.expression,
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: selectedCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
    },
  }, evidence);
  return acceptRustPolicy({
    selectedSignature: {
      member: {
        id: fact.operationId,
        sourceName: "constructor",
        targetName: "JsRegExp::new",
        kind: "constructor",
        parameters: [
          { name: "pattern", type: rustStringTargetType(), passingMode: "by-value" },
          { name: "flags", type: rustStringTargetType(), passingMode: "by-value" },
        ],
        returnType: resultCarrier,
      },
      ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
      ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
      ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
      sourceArgumentBindings: request.source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    },
  }, evidence);
}

function mapSelectedJsSpecialCall(
  request: RustCheckedCallSelectionInput,
  ownerName: string,
  memberName: string,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const objectProjection = selectedObjectShapeProjection(
    ownerName,
    memberName,
  );
  if (objectProjection !== undefined) {
    return mapSelectedObjectShapeProjection(
      request,
      objectProjection,
      context,
      options,
    );
  }
  if (ownerName === "String" && memberName === "match") {
    const [argument] = selectedCallArgumentNodes(request);
    const creation = argument === undefined
      ? undefined
      : context.facts.resolve(argument, rustTargetOperationFactKey);
    if (creation === undefined || creation.kind !== "regexp-create") {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_REGEXP_MATCH_PATTERN_NOT_FINALIZED",
        "Rust String.match requires an inline RegExp whose checked construction fact finalizes the result shape.",
      );
    }
    const global = creation.flags.includes("g");
    const resultCarrier: TargetTypeRef = global
      ? rustOptionTargetType(rustJsArrayTargetType(rustStringTargetType()))
      : rustOptionTargetType({ kind: "target-named", id: "rust.js.JsRegExpMatch" });
    return acceptSelectedCall(request, {
      kind: "provider-operation",
      operationId: `tsonic.rust.js.String.match.${global ? "global" : "first"}`,
      operationKind: "method",
      target: {
        form: "arg-receiver-method",
        name: global ? "match_strings" : "match_first",
        argModes: ["ref"],
      },
      parameterCarriers: [{ kind: "target-named", id: "rust.js.JsRegExp" }],
      resultCarrier,
      isAsync: false,
      isFallible: true,
      errorBoundary: "provider-native",
    }, [{ kind: "target-named", id: "rust.js.JsRegExp" }], context, options, {
      sourceName: memberName,
    });
  }
  if (ownerName !== "JSON" || memberName !== "stringify" || selectedCallArgumentNodes(request).length !== 3) {
    return undefined;
  }
  const [valueNode, replacerNode, spaceNode] = selectedCallArgumentNodes(request).map((argument) => asNode(argument, context));
  const ast = context.ast;
  if (valueNode === undefined || replacerNode === undefined || spaceNode === undefined || ast.kindName(replacerNode) !== "KindNullKeyword") {
    return rejectSelectedOperation(request.source.call, context, "RUST_JSON_STRINGIFY_REPLACER_UNSUPPORTED", "Rust JSON.stringify supports the selected three-argument overload only with a null replacer and compile-time string/number indentation.");
  }
  let indent: string | undefined;
  if (ast.kindName(spaceNode) === "KindNumericLiteral") {
    indent = " ".repeat(Math.min(10, Math.max(0, Math.trunc(Number(ast.text(spaceNode))))));
  } else if (ast.kindName(spaceNode) === "KindStringLiteral") {
    indent = ast.text(spaceNode).slice(0, 10);
  }
  if (indent === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_JSON_STRINGIFY_INDENT_UNSUPPORTED", "Rust JSON.stringify indentation must be a compile-time string or number selected by the checked source call.");
  }
  const resultCarrier = rustOptionTargetType(rustStringTargetType());
  return acceptSelectedCall(request, {
    kind: "provider-operation",
    operationId: "tsonic.rust.js.JSON.stringify.indent",
    operationKind: "method",
    target: {
      form: "call",
      path: "js_abi::json_stringify_with_indent",
      argModes: ["ref"],
      argOrder: [0],
      trailingArguments: [{ kind: "string", value: indent }],
    },
    parameterCarriers: [rustJsValueTargetType()],
    compileTimeSourceArgumentIndexes: [1, 2],
    resultCarrier,
    isAsync: false,
    isFallible: true,
    errorBoundary: "provider-native",
  }, [rustJsValueTargetType()], context, options, {
    sourceName: memberName,
  });
}

interface SelectedObjectShapeProjection {
  readonly projection: Extract<
    RustTargetOperationFact,
    { readonly kind: "object-shape-projection" }
  >["projection"];
  readonly sourceName: string;
  readonly sourceValue: "first-argument" | "receiver";
  readonly keyArgumentIndex?: number;
  readonly expectedArgumentCount: number;
  readonly static: boolean;
}

function selectedObjectShapeProjection(
  ownerName: string,
  memberName: string,
): SelectedObjectShapeProjection | undefined {
  if (ownerName === "ObjectConstructor") {
    if (memberName === "keys" || memberName === "values" || memberName === "entries") {
      return {
        projection: memberName,
        sourceName: memberName,
        sourceValue: "first-argument",
        expectedArgumentCount: 1,
        static: true,
      };
    }
    if (memberName === "hasOwn") {
      return {
        projection: "has-own",
        sourceName: memberName,
        sourceValue: "first-argument",
        keyArgumentIndex: 1,
        expectedArgumentCount: 2,
        static: true,
      };
    }
  }
  return ownerName === "Object" && memberName === "hasOwnProperty"
    ? {
        projection: "has-own",
        sourceName: memberName,
        sourceValue: "receiver",
        keyArgumentIndex: 0,
        expectedArgumentCount: 1,
        static: false,
      }
    : undefined;
}

function mapSelectedObjectShapeProjection(
  request: RustCheckedCallSelectionInput,
  selection: SelectedObjectShapeProjection,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const sourceArguments = request.source.sourceArguments;
  const sourceValue = selection.sourceValue === "receiver"
    ? request.source.sourceReceiver
    : sourceArguments[0];
  if (sourceArguments.length !== selection.expectedArgumentCount || sourceValue === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_EVIDENCE_MISSING",
      `Selected Object.${selection.sourceName} call does not carry its exact receiver/argument evidence.`,
    );
  }
  const sourceValueNode = asNode(sourceValue.expression, context);
  const sourceValueCarrier = selectedValueCarrier(
    sourceValue.expression,
    sourceValue.type,
    context,
    options,
  );
  const shape = options.sourceTypes.structuralObjectForType(sourceValue.type);
  if (sourceValueNode === undefined || sourceValueCarrier === undefined || shape === undefined ||
    shape.storage !== "object-handle" ||
    !rustTargetTypeRefEquals(sourceValueCarrier, shape.carrier)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_NOT_CLOSED",
      `Selected Object.${selection.sourceName} call requires one exact generated structural object carrier.`,
    );
  }
  const orderedFields = selectedAuthoredObjectFields(shape, context);
  if (orderedFields.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_NOT_CLOSED",
      orderedFields.reason,
    );
  }
  const resolvedSourceResult = resolveRustTargetTypeRef(
    request.source.sourceResultType,
    context,
    options,
  );
  const innerResultCarrier = request.source.optionalChain
    ? rustOptionElementCarrier(resolvedSourceResult)
    : resolvedSourceResult;
  if (innerResultCarrier === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_RESULT_MISSING",
      `Selected Object.${selection.sourceName} call has no exact closed result carrier.`,
    );
  }
  const projectedFields = selectObjectShapeProjectionFields(
    selection.projection,
    orderedFields.fields,
    innerResultCarrier,
  );
  if (projectedFields.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_RESULT_INVALID",
      projectedFields.reason,
    );
  }
  const keyExpression = selection.keyArgumentIndex === undefined
    ? undefined
    : asNode(sourceArguments[selection.keyArgumentIndex]?.expression, context);
  if (selection.projection === "has-own" && keyExpression === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_KEY_MISSING",
      `Selected Object.${selection.sourceName} call has no exact checked key expression.`,
    );
  }
  const optionalResult = selectRustOptionalCallResult(
    request,
    innerResultCarrier,
    context,
    options,
  );
  if (optionalResult.kind === "rejected" || resolvedSourceResult === undefined ||
    !rustTargetTypeRefEquals(optionalResult.resultCarrier, resolvedSourceResult)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_OPTIONAL_RESULT_INVALID",
      optionalResult.kind === "rejected"
        ? optionalResult.message
        : `Selected Object.${selection.sourceName} result conflicts with its optional-chain carrier.`,
    );
  }
  const operationId = `tsonic.rust.js.object-shape.${selection.projection}`;
  const fact: Extract<RustTargetOperationFact, { readonly kind: "object-shape-projection" }> = {
    kind: "object-shape-projection",
    operationId,
    projection: selection.projection,
    sourceValue: sourceValueNode,
    sourceValueOrigin: selection.sourceValue === "receiver"
      ? { kind: "receiver" }
      : { kind: "argument", index: 0 },
    sourceValueCarrier,
    ...(keyExpression === undefined ? {} : { keyExpression }),
    fields: projectedFields.fields,
    storage: shape.storage,
    resultCarrier: innerResultCarrier,
  };
  const evidence = [{ message: `rust selected closed Object.${selection.sourceName} projection` }];
  const parameterCarriers = sourceArguments.map((argument) =>
    selectedSourceValueCarrier(argument, context, options));
  if (parameterCarriers.some((carrier) => carrier === undefined)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_PARAMETER_MISSING",
      `Selected Object.${selection.sourceName} call has an argument without a closed Rust carrier.`,
    );
  }
  if (selection.keyArgumentIndex !== undefined &&
    !rustTargetTypeRefEquals(
      parameterCarriers[selection.keyArgumentIndex],
      rustStringTargetType(),
    )) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_KEY_INVALID",
      `Selected Object.${selection.sourceName} key does not have the exact source string carrier.`,
    );
  }
  const parameterModes = sourceArguments.map((_, index) =>
    selection.static && index === 0 ? "borrow-shared" as const : "by-value" as const);
  for (const [index, argument] of sourceArguments.entries()) {
    const mode = parameterModes[index]!;
    context.facts.set(argument.expression, rustArgumentPassingKey, {
      mode,
      ...(mode === "borrow-shared"
        ? { storageExpression: argument.expression }
        : {}),
    }, [{ message: `rust Object projection argument ${index} passes as ${mode}` }]);
  }
  const operation: RustTargetOperationSelection = {
    operationId,
    operationKind: "method",
    targetOperation: operationId,
    resultType: optionalResult.resultCarrier,
    provenance: {
      sourceExpression: request.source.call,
      sourceReceiver: sourceValue.expression,
      sourceCallee: request.source.sourceCallee.expression,
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: selectedCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
    },
  };
  const member: RustTargetMember = {
    id: operationId,
    sourceName: selection.sourceName,
    targetName: operationId,
    kind: "method",
    ...(selection.static ? { static: true } : {}),
    parameters: parameterCarriers.map((carrier, index) => ({
      name: `arg${index}`,
      type: carrier!,
      passingMode: parameterModes[index]!,
    })),
    returnType: innerResultCarrier,
  };
  const selectedSignature = {
    member,
    ...(!selection.static ? { sourceSelectedReceiverCarrier: sourceValueCarrier } : {}),
    ...(request.source.selectedSignature === undefined
      ? {}
      : { sourceSignature: request.source.selectedSignature }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceDeclaration: request.sourceSelectedDeclaration }),
    ...(selectedCallCalleeSymbol(request) === undefined
      ? {}
      : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
    ...(selectedCallCalleeDeclaration(request) === undefined
      ? {}
      : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
    ...(request.source.sourceResultType === undefined
      ? {}
      : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    ...(request.source.sourceSelectedMethodTypeArguments === undefined
      ? {}
      : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
  };
  context.facts.set(request.source.call, rustTargetOperationFactKey, fact, evidence);
  if (optionalResult.fact !== undefined) {
    context.facts.set(
      request.source.call,
      rustOptionalChainFactKey,
      optionalResult.fact,
      [{ message: `rust optional Object.${selection.sourceName} projection` }],
    );
  }
  context.facts.set(request.source.call, rustSelectedOperationKey, operation, evidence);
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}

type SelectedAuthoredObjectFields =
  | { readonly kind: "resolved"; readonly fields: readonly RustSourceObjectField[] }
  | { readonly kind: "rejected"; readonly reason: string };

function selectedAuthoredObjectFields(
  shape: RustSourceObjectShape,
  context: RustOperationPolicyContext,
): SelectedAuthoredObjectFields {
  const selected: {
    readonly field: RustSourceObjectField;
    readonly owner: Node;
    readonly start: number;
  }[] = [];
  for (const field of shape.fields) {
    const declarations = field.declarations.filter((declaration) => {
      const kind = context.ast.kindName(declaration);
      return kind === KindPropertyAssignment || kind === KindShorthandPropertyAssignment;
    });
    if (declarations.length !== 1 || field.declarations.length !== 1) {
      return {
        kind: "rejected",
        reason: `Closed Object projection member '${field.sourceName}' is not owned by one exact object-literal property.`,
      };
    }
    const declaration = declarations[0]!;
    const owner = context.ast.parent(declaration);
    const range = context.ast.authoredRange(declaration);
    if (owner === undefined || context.ast.kindName(owner) !== "KindObjectLiteralExpression" ||
      range.kind !== "authored" || context.ast.questionToken(declaration) !== undefined) {
      return {
        kind: "rejected",
        reason: `Closed Object projection member '${field.sourceName}' has no exact required own-property declaration.`,
      };
    }
    selected.push({ field, owner, start: range.start });
  }
  const owner = selected[0]?.owner;
  if (owner === undefined || selected.some((entry) => entry.owner !== owner) ||
    new Set(selected.map((entry) => entry.start)).size !== selected.length) {
    return {
      kind: "rejected",
      reason: "Closed Object projection fields do not belong to one unambiguous authored object literal.",
    };
  }
  const authored = [...selected]
    .sort((left, right) => left.start - right.start)
    .map((entry) => entry.field);
  return {
    kind: "resolved",
    fields: orderEnumerableOwnStringProperties(
      authored,
      (field) => field.sourceName,
    ),
  };
}

type SelectedProjectionFields =
  | {
      readonly kind: "resolved";
      readonly fields: Extract<
        RustTargetOperationFact,
        { readonly kind: "object-shape-projection" }
      >["fields"];
    }
  | { readonly kind: "rejected"; readonly reason: string };

function selectObjectShapeProjectionFields(
  projection: SelectedObjectShapeProjection["projection"],
  fields: readonly RustSourceObjectField[],
  resultCarrier: TargetTypeRef,
): SelectedProjectionFields {
  if (projection === "has-own") {
    return rustTargetTypeRefEquals(resultCarrier, rustSourcePrimitiveTargetType("bool"))
      ? { kind: "resolved", fields: fields.map(projectIdentityField) }
      : { kind: "rejected", reason: "Object.hasOwn requires an exact boolean result carrier." };
  }
  if (!isRustJsArrayCarrier(resultCarrier) || resultCarrier.typeArguments?.length !== 1) {
    return {
      kind: "rejected",
      reason: `Object.${projection} requires an exact JavaScript-array result carrier.`,
    };
  }
  const elementCarrier = resultCarrier.typeArguments[0]!;
  if (projection === "keys") {
    return rustTargetTypeRefEquals(elementCarrier, rustStringTargetType())
      ? { kind: "resolved", fields: fields.map(projectIdentityField) }
      : { kind: "rejected", reason: "Object.keys requires an exact string-array result carrier." };
  }
  const valueCarrier = projection === "entries" && elementCarrier.kind === "tuple" &&
      elementCarrier.elements.length === 2 &&
      rustTargetTypeRefEquals(elementCarrier.elements[0]!, rustStringTargetType())
    ? elementCarrier.elements[1]
    : projection === "values"
      ? elementCarrier
      : undefined;
  if (valueCarrier === undefined) {
    return {
      kind: "rejected",
      reason: "Object.entries requires an exact JavaScript array of [string, value] tuples.",
    };
  }
  const projected = fields.map((field) => {
    if (rustTargetTypeRefEquals(field.resultCarrier, valueCarrier)) {
      return projectIdentityField(field);
    }
    const conversion = selectRustSourceValueConversion(
      field.resultCarrier,
      valueCarrier,
    );
    return conversion === undefined || rustValueConversionIsFallible(conversion)
      ? undefined
      : {
          ...projectIdentityField(field),
          conversion,
        };
  });
  const unresolvedIndex = projected.findIndex((field) => field === undefined);
  return unresolvedIndex === -1
    ? {
        kind: "resolved",
        fields: projected as NonNullable<typeof projected[number]>[],
      }
    : {
        kind: "rejected",
        reason: `Object.${projection} member '${fields[unresolvedIndex]!.sourceName}' has no exact infallible result conversion.`,
      };
}

function projectIdentityField(
  field: RustSourceObjectField,
): Extract<
  RustTargetOperationFact,
  { readonly kind: "object-shape-projection" }
>["fields"][number] {
  return {
    sourceName: field.sourceName,
    storageIndex: field.storageIndex,
    valueCarrier: field.resultCarrier,
  };
}

function acceptProjectSourceCall(
  request: RustCheckedCallSelectionInput,
  selectedDeclaration: Node,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const { ast } = context;
  const selectedKind = ast.kindName(selectedDeclaration);
  const construction = checkedCallIsConstruction(request, context) ||
    selectedKind === "KindConstructor";
  if (construction && selectedKind !== "KindClassDeclaration" && selectedKind !== "KindConstructor") {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_CONSTRUCTOR_DECLARATION_INVALID", "Project-source construction evidence is not an exact constructor declaration or an implicit-constructor class declaration.");
  }
  const selectedCalleeDeclaration = asNode(selectedCallCalleeDeclaration(request), context);
  const selectedOwner = construction && selectedCalleeDeclaration !== undefined &&
      ast.kindName(selectedCalleeDeclaration) === "KindClassDeclaration"
    ? selectedCalleeDeclaration
    : selectedKind === "KindClassDeclaration"
      ? selectedDeclaration
      : selectedKind === "KindConstructor" ? ast.parent(selectedDeclaration) : undefined;
  const selectedOwnerDefinition = options.projectTypes.definitionForDeclaration(selectedOwner);
  const selectedConstructor = construction && selectedOwnerDefinition?.kind === "class"
    ? selectedProjectConstructor(
        selectedOwnerDefinition,
        request,
        options,
      )
    : undefined;
  if (construction && selectedConstructor === undefined) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CONSTRUCTOR_SIGNATURE_MISSING",
      "Project construction requires one exact effective constructor signature from shared source-program navigation.",
    );
  }
  if (selectedConstructor !== undefined &&
    (request.source.sourceSelectedSignatureParameters.length !== selectedConstructor.parameters.length ||
      request.source.sourceSelectedSignatureParameters.some((parameter, index) => {
        const expected = selectedConstructor.parameters[index];
        return expected === undefined ||
          parameter.parameterDeclaration !== expected.parameterDeclaration ||
          parameter.acceptsOmission !== expected.acceptsOmission ||
          parameter.rest !== expected.rest;
      }))) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SELECTED_CONSTRUCTOR_PARAMETER_EVIDENCE_CONFLICT",
      "The selected constructor parameter evidence conflicts with the exact effective constructor signature.",
    );
  }
  const selectedCallableDeclaration = selectedConstructor?.declaration ?? selectedDeclaration;
  const selectedCallableKind = ast.kindName(selectedCallableDeclaration);
  const callableImplementationRequired = selectedCallableKind === "KindFunctionDeclaration" ||
    selectedCallableKind === "KindMethodDeclaration" ||
    selectedCallableKind === "KindMethodSignature" ||
    selectedCallableKind === "KindConstructor";
  const callableImplementation = !callableImplementationRequired
    ? undefined
    : context.source.navigation.callableImplementation(selectedCallableDeclaration);
  const callableOwner = options.projectTypes.definitionContainingDeclaration(
    selectedCallableDeclaration,
  );
  const selectedContractHasNoBody = ast.body(selectedCallableDeclaration) === undefined &&
    callableOwner !== undefined &&
    (callableOwner.kind === "interface" || options.projectTypes.isPolymorphic(callableOwner));
  if (callableImplementationRequired &&
    callableImplementation?.kind !== "resolved" &&
    !selectedContractHasNoBody) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_SOURCE_CALL_IMPLEMENTATION_MISSING",
      callableImplementation?.kind === "unresolved"
        ? callableImplementation.reason
        : "The selected project-source callable has no exact concrete implementation.",
    );
  }
  const callableDeclaration = callableImplementation?.kind === "resolved"
    ? callableImplementation.implementation.declaration
    : selectedCallableDeclaration;
  const targetTypeArguments = mapSelectedTargetTypeArguments(request, context, options);
  if (targetTypeArguments === undefined && (request.source.sourceSelectedMethodTypeArguments?.length ?? 0) > 0) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_TYPE_ARGUMENT_CARRIER_MISSING", "A TSTS-selected project-source method type argument could not map to a closed Rust target type.");
  }
  const containingDefinition = options.projectTypes.definitionContainingDeclaration(
    asNode(request.source.call, context),
  );
  const selectedOwnerRelationship = selectedOwnerDefinition === undefined ||
      containingDefinition?.kind !== "class"
    ? undefined
    : options.projectTypes.relationship(
        options.projectTypes.openCarrier(containingDefinition),
        selectedOwnerDefinition,
      );
  const ownerCarrier = construction
    ? selectedOwnerRelationship?.kind === "related"
      ? selectedOwnerRelationship.targetType
      : resolveRustTargetTypeRef(request.source.sourceResultType, context, options)
    : resolveRustTargetTypeRef(request.source.sourceReceiver?.type, context, options);
  const sourceParameters = ast.kindName(callableDeclaration) === "KindClassDeclaration"
    ? request.source.sourceSelectedSignatureParameters.map((parameter) =>
        parameter.parameterDeclaration)
    : ast.parameters(callableDeclaration);
  const parameters = sourceParameters.map((parameter, index) => {
    if (parameter === undefined) {
      return undefined;
    }
    const abi = options.sourceCallableAbi.resolveParameterAbi(parameter, context, options);
    if (abi === undefined) {
      return undefined;
    }
    const parameterCarrier = ownerCarrier === undefined
      ? abi.parameterCarrier
      : options.projectTypes.instantiateMemberCarrier(
          parameter,
          ownerCarrier,
          abi.parameterCarrier,
        );
    const valueCarrier = ownerCarrier === undefined
      ? abi.valueCarrier
      : options.projectTypes.instantiateMemberCarrier(
          parameter,
          ownerCarrier,
          abi.valueCarrier,
        );
    if (parameterCarrier === undefined || valueCarrier === undefined) {
      return undefined;
    }
    return {
      name: ast.text(ast.name(parameter)) || `arg${index}`,
      type: parameterCarrier,
      passingMode: abi.mode === "mut-ref"
        ? "borrow-mut" as const
        : abi.mode === "ref" ? "borrow-shared" as const : "by-value" as const,
    };
  });
  if (parameters.some((parameter) => parameter === undefined)) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SOURCE_CALL_PARAMETER_CARRIER_MISSING", "The exact TSTS-selected project-source declaration has a parameter without a closed Rust target carrier.");
  }
  let returnType: TargetTypeRef | undefined;
  if (construction) {
    returnType = resolveRustTargetTypeRef(
      request.source.sourceResultType,
      context,
      options,
    );
  } else {
    const sourceReturn = Node_Type(ast, callableDeclaration) ?? request.source.sourceResultType;
    const declaredReturnType = sourceReturn === undefined
      ? undefined
      : resolveRustTargetTypeRef(sourceReturn, context, options);
    returnType = declaredReturnType === undefined || ownerCarrier === undefined
      ? declaredReturnType
      : options.projectTypes.instantiateMemberCarrier(
          callableDeclaration,
          ownerCarrier,
          declaredReturnType,
        );
  }
  if (returnType === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SOURCE_CALL_RETURN_CARRIER_MISSING", "The exact TSTS-selected project-source declaration has no closed Rust return carrier.");
  }
  const optionalResult = selectRustOptionalCallResult(
    request,
    returnType,
    context,
    options,
  );
  if (optionalResult.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OPTIONAL_CALL_CONTRACT_INVALID",
      optionalResult.message,
    );
  }
  const sourceName = construction
    ? "constructor"
    : ast.kindName(callableDeclaration) === "KindFunctionType" ||
        ast.kindName(callableDeclaration) === "KindCallSignature"
      ? "call"
      : rustProjectCallableTargetName(callableDeclaration, context) ?? "<anonymous>";
  const memberDeclaration = construction ? selectedOwner ?? callableDeclaration : callableDeclaration;
  const fileName = ast.getFileName(ast.getSourceFile(memberDeclaration));
  const targetName = selectedConstructor?.targetName ?? sourceName;
  const member: RustTargetMember = {
    id: `tsonic.rust.source.call:${fileName}:${ast.pos(memberDeclaration)}:${ast.end(memberDeclaration)}:${targetName}`,
    sourceName,
    targetName,
    kind: construction ? "constructor" : "method",
    parameters: parameters as NonNullable<RustTargetMember["parameters"]>,
    returnType,
    ...((request.source.sourceSelectedMethodTypeArguments?.length ?? 0) === 0
      ? {}
      : {
          typeParameters: request.source.sourceSelectedMethodTypeArguments!.map((argument) => ({
            name: argument.typeParameterName,
          })),
        }),
  };
  const selectedSignature = {
    member,
    ...(construction || ownerCarrier === undefined
      ? {}
      : { sourceSelectedReceiverCarrier: ownerCarrier }),
    sourceDeclaration: callableDeclaration,
    ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
    ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
    ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
    ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
    sourceArgumentBindings: request.source.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
    ...(request.source.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
    ...(targetTypeArguments === undefined ? {} : { targetTypeArguments }),
  };
  if (optionalResult.fact !== undefined) {
    context.facts.set(
      request.source.call,
      rustOptionalChainFactKey,
      optionalResult.fact,
      [{ message: `rust optional call ${optionalResult.fact.lowering}` }],
    );
  }
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature);
  return acceptRustPolicy({
    selectedSignature: {
      member,
      ...(construction || ownerCarrier === undefined
        ? {}
        : { sourceSelectedReceiverCarrier: ownerCarrier }),
      sourceDeclaration: callableDeclaration,
      ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
      ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
      ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
      ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
      sourceArgumentBindings: request.source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
      ...(request.source.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
      ...(targetTypeArguments === undefined ? {} : { targetTypeArguments }),
    },
  }, [{ message: `rust selected project-source call ${member.id}` }]);
}

function selectedProjectConstructor(
  definition: import("./project-type-policy.js").RustProjectTypeDefinition,
  request: RustCheckedCallSelectionInput,
  options: RustOperationsProviderOptions,
): import("./project-type-policy.js").RustProjectConstructorSignature | undefined {
  const exact = options.projectTypes.constructorForSignature(
    definition,
    request.source.selectedSignature,
  );
  if (exact !== undefined) {
    return exact;
  }
  const candidates = options.projectTypes.constructorsForDefinition(definition).filter((candidate) =>
    candidate.parameters.length === request.source.sourceSelectedSignatureParameters.length &&
    candidate.parameters.every((parameter, index) => {
      const selected = request.source.sourceSelectedSignatureParameters[index];
      return selected !== undefined &&
        parameter.parameterDeclaration === selected.parameterDeclaration &&
        parameter.acceptsOmission === selected.acceptsOmission &&
        parameter.rest === selected.rest;
    }));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function mapSelectedTargetTypeArguments(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly TargetTypeRef[] | undefined {
  const sourceArguments = request.source.sourceSelectedMethodTypeArguments;
  if (sourceArguments === undefined || sourceArguments.length === 0) {
    return undefined;
  }
  const mapped = sourceArguments.map((argument) =>
    resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, options));
  return mapped.every((argument) => argument !== undefined)
    ? mapped as TargetTypeRef[]
    : undefined;
}

function instantiateSelectedCallTemplate(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  context: RustOperationPolicyContext,
  resolutionOptions: RustOperationsProviderOptions,
): InstantiatedProviderOperationTemplate | undefined {
  const rawReceiverCarrier = selectedCallReceiverValueCarrier(
    request,
    context,
    resolutionOptions,
  );
  const selectedParameterCarriers = request.source.sourceSelectedSignatureParameters.map((parameter) =>
    resolveRustTargetTypeRef(parameter.selectedType, context, resolutionOptions));
  const selectedResultCarrier = request.source.sourceResultType === undefined
    ? undefined
    : resolveRustTargetTypeRef(request.source.sourceResultType, context, resolutionOptions);
  const directTypeArguments = new Map<string, TargetTypeRef>();
  for (const argument of request.source.sourceSelectedMethodTypeArguments ?? []) {
    const carrier = resolveRustTargetTypeRef(
      argument.explicitTypeNode ?? argument.selectedType,
      context,
      resolutionOptions,
    );
    if (carrier !== undefined) {
      directTypeArguments.set(argument.typeParameterName, carrier);
    }
  }
  return instantiateProviderOperationTemplate(template, {
    sourceReceiverCarrier: rawReceiverCarrier,
    sourceParameterCarriers: selectedParameterCarriers,
    sourceResultCarrier: selectedResultCarrier,
    directTypeArguments,
  });
}

function acceptSelectedCall(
  request: RustCheckedCallSelectionInput,
  template: RustProviderOperationTemplate,
  parameterCarriers: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationPolicyContext,
  resolutionOptions: RustOperationsProviderOptions,
  callIdentity: {
    readonly sourceName: string;
    readonly providerDeclaration?: ProviderDeclarationIdentity;
  },
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const instantiation = instantiateSelectedCallTemplate(
    request,
    template,
    context,
    resolutionOptions,
  );
  if (instantiation === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_PROVIDER_TYPE_INSTANTIATION_NOT_PROVEN", `Selected call '${callIdentity.sourceName}' does not prove one closed instantiation of its Rust provider type parameters.`);
  }
  const instantiatedTemplate = instantiation.template;
  const sourceArguments = selectedCallSourceCarriers(
    request,
    instantiatedTemplate,
    instantiatedTemplate.parameterCarriers ?? parameterCarriers,
    context,
    resolutionOptions,
  );
  if (sourceArguments.kind === "missing") {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_PARAMETER_CARRIER_MISSING", `Selected call '${callIdentity.sourceName}' has no closed Rust carrier for every target parameter.`);
  }
  if (sourceArguments.kind === "incompatible") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_CALL_ARGUMENT_CONVERSION_UNSUPPORTED",
      "The TSTS-selected call argument cannot be represented by the selected Rust target parameter carrier.",
      [{
        message: `sourceArgumentIndex=${sourceArguments.sourceIndex}; actual=${JSON.stringify(sourceArguments.actual)}; expected=${JSON.stringify(sourceArguments.expected)}`,
      }],
    );
  }
  const selectedReceiverCarrier = selectedCallReceiverCarrier(
    request,
    instantiatedTemplate.target,
    context,
    resolutionOptions,
  );
  if (providerFormRequiresSourceReceiver(instantiatedTemplate.target) && selectedReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_RECEIVER_CARRIER_MISSING", `Selected call '${callIdentity.sourceName}' has no closed Rust receiver carrier.`);
  }
  const fact = finalizeProviderOperationFact(instantiatedTemplate, sourceArguments.carriers, selectedReceiverCarrier);
  if (fact === undefined) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `Selected call '${callIdentity.sourceName}' cannot finalize one total Rust operation ABI.`);
  }
  const targetTypeArguments = request.source.sourceSelectedMethodTypeArguments?.map((argument) =>
    resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, resolutionOptions));
  if (targetTypeArguments?.some((argument) => argument === undefined) === true) {
    return rejectSelectedOperation(request.source.call, context, "RUST_SELECTED_TYPE_ARGUMENT_CARRIER_MISSING", `Selected generic call '${callIdentity.sourceName}' has a source-selected type argument that cannot map to a closed Rust target type.`);
  }
  const optionalResult = selectRustOptionalCallResult(
    request,
    fact.resultCarrier,
    context,
    resolutionOptions,
  );
  if (optionalResult.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OPTIONAL_CALL_CONTRACT_INVALID",
      optionalResult.message,
    );
  }
  const resultCarrier = optionalResult.resultCarrier;
  const preparedResult = context.facts.resolve(
    request.source.call,
    rustPreparedOperationResultFactKey,
  );
  if (preparedResult !== undefined && (
    preparedResult.operationId !== fact.operationId ||
    preparedResult.operationKind !== fact.abi.operationKind ||
    !rustTargetTypeRefEquals(preparedResult.resultCarrier, resultCarrier)
  )) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_PREPARED_OPERATION_RESULT_CONFLICT",
      `Finalized call '${callIdentity.sourceName}' conflicts with its exact prepared Rust operation result.`,
      [{
        message: `prepared=${JSON.stringify(preparedResult)}; finalized=${JSON.stringify({ operationId: fact.operationId, operationKind: fact.abi.operationKind, resultCarrier })}`,
      }],
    );
  }
  const operation: RustTargetOperationSelection = {
    operationId: fact.operationId,
    operationKind: fact.abi.operationKind,
    targetOperation: rustTargetOperationText(fact),
    resultType: resultCarrier,
    provenance: {
      sourceExpression: request.source.call,
      sourceCallee: request.source.sourceCallee.expression,
      sourceSelectedSignature: request.source.selectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: selectedCallCalleeSymbol(request),
      sourceResultType: request.source.sourceResultType,
      ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
    },
  };
  const evidence = [{ message: `rust selected call ${fact.operationId}` }];
  for (const pending of sourceArguments.reconciliations) {
    const argument = selectedCallArgumentNodes(request)[pending.sourceIndex];
    if (argument === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_ARGUMENT_BINDING_MISSING",
        `Selected call '${callIdentity.sourceName}' has no exact source argument ${pending.sourceIndex}.`,
      );
    }
    recordRustValueCarrierReconciliation(context.facts, argument, pending.reconciliation);
  }
  for (const sourceArgument of fact.abi.sourceArguments) {
    if (sourceArgument.disposition !== "runtime") {
      continue;
    }
    const argument = selectedCallArgumentNodes(request)[sourceArgument.sourceIndex];
    if (argument === undefined) {
      return rejectSelectedOperation(
        request.source.call,
        context,
        "RUST_SELECTED_ARGUMENT_BINDING_MISSING",
        `Selected call '${callIdentity.sourceName}' has no exact source argument ${sourceArgument.sourceIndex}.`,
      );
    }
    const mode = rustArgumentPassingMode(sourceArgument.mode);
    context.facts.set(argument, rustArgumentPassingKey, {
      mode,
      ...(mode === "borrow-shared" || mode === "borrow-mut"
        ? { storageExpression: argument }
        : {}),
    }, [{ message: `rust selected argument ${sourceArgument.sourceIndex} passes as ${mode}` }]);
  }
  context.facts.set(request.source.call, rustTargetOperationFactKey, {
    ...fact,
  }, evidence);
  if (optionalResult.fact !== undefined) {
    context.facts.set(
      request.source.call,
      rustOptionalChainFactKey,
      optionalResult.fact,
      [{ message: `rust optional call ${optionalResult.fact.lowering}` }],
    );
  }
  context.facts.set(request.source.call, rustSelectedOperationKey, operation, evidence);
  const member: RustTargetMember = {
    id: fact.operationId,
    sourceName: callIdentity.sourceName,
    targetName: operation.targetOperation,
    kind: fact.abi.operationKind === "constructor" ? "constructor" : "method",
    parameters: fact.abi.sourceArguments.map((argument, index) => ({
      name: `arg${index}`,
      type: argument.carrier,
      passingMode: rustArgumentPassingMode(argument.mode),
    })),
    returnType: fact.resultCarrier,
    ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
  };
  const selectedSignature = {
      member,
      ...(request.source.selectedSignature === undefined ? {} : { sourceSignature: request.source.selectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(selectedCallCalleeSymbol(request) === undefined ? {} : { sourceCalleeSymbol: selectedCallCalleeSymbol(request) }),
      ...(selectedCallCalleeDeclaration(request) === undefined ? {} : { sourceCalleeDeclaration: selectedCallCalleeDeclaration(request) }),
      ...(request.source.sourceResultType === undefined ? {} : { sourceReturnType: request.source.sourceResultType }),
      sourceArgumentBindings: request.source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.source.sourceSelectedSignatureParameters,
      ...(request.source.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.source.sourceSelectedMethodTypeArguments }),
      ...(targetTypeArguments === undefined ? {} : { targetTypeArguments: targetTypeArguments as TargetTypeRef[] }),
      ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
    };
  context.facts.set(request.source.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}

type SelectedCallSourceCarriers =
  | {
      readonly kind: "resolved";
      readonly carriers: readonly TargetTypeRef[];
      readonly reconciliations: readonly {
        readonly sourceIndex: number;
        readonly reconciliation: RustAppliedValueCarrierReconciliation;
      }[];
    }
  | { readonly kind: "missing" }
  | {
      readonly kind: "incompatible";
      readonly sourceIndex: number;
      readonly actual?: TargetTypeRef;
      readonly expected?: TargetTypeRef;
    };

function selectedCallSourceCarriers(
  request: RustCheckedCallSelectionInput,
  fact: RustProviderOperationTemplate,
  declared: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): SelectedCallSourceCarriers {
  const compileTimeIndexes = new Set(fact.compileTimeSourceArgumentIndexes ?? []);
  const runtimeIndexes = selectedCallArgumentNodes(request)
    .map((_argument, index) => index)
    .filter((index) => !compileTimeIndexes.has(index));
  const declaredBySourceIndex = new Map<number, TargetTypeRef | undefined>();
  for (const sourceIndex of runtimeIndexes) {
    const bindings = request.source.sourceArgumentBindings.filter((binding) =>
      binding.sourceArgumentIndex === sourceIndex);
    const first = bindings[0];
    if (first === undefined || bindings.some((binding) =>
      binding.sourceParameterIndex !== first.sourceParameterIndex ||
      binding.sourceForm !== first.sourceForm) ||
      request.source.sourceSelectedSignatureParameters[first.sourceParameterIndex] === undefined) {
      return { kind: "missing" };
    }
    declaredBySourceIndex.set(sourceIndex, declared?.[first.sourceParameterIndex]);
  }
  let incompatibility: Extract<SelectedCallSourceCarriers, { readonly kind: "incompatible" }> | undefined;
  const reconciliations: {
    readonly sourceIndex: number;
    readonly reconciliation: RustAppliedValueCarrierReconciliation;
  }[] = [];
  const actual = request.source.sourceArguments.map((sourceArgument, index) => {
    const argument = sourceArgument.expression;
    const targetExpected = selectedCallArgumentTargetCarrier(fact.target, index);
    const expected = targetExpected ?? declaredBySourceIndex.get(index);
    const resolved = selectedSourceValueCarrier(sourceArgument, context, options);
    const normalized = normalizeSelectedArgumentCarrier(argument, resolved, expected, context, options);
    let effective = rustEffectiveValueCarrier(context.facts, argument) ?? normalized;
    if (effective !== undefined && expected !== undefined &&
      !rustTargetTypeRefEquals(effective, expected)) {
      const reconciliation = selectRustValueCarrierReconciliation(
        effective,
        expected,
        options.projectTypes,
      );
      if (reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
        if (reconciliation.kind === "project-upcast" || targetExpected === undefined) {
          reconciliations.push({ sourceIndex: index, reconciliation });
          effective = expected;
        }
      } else if (reconciliation.kind === "incompatible") {
        incompatibility ??= { kind: "incompatible", sourceIndex: index, actual: effective, expected };
      }
    }
    return effective ?? expected;
  });
  if (incompatibility !== undefined) {
    return incompatibility;
  }
  if (actual.some((carrier) => carrier === undefined)) {
    return { kind: "missing" };
  }
  if (fact.target.form === "call-str-slice" || fact.target.form === "free-call-str-slice") {
    const stringCarrier = rustStringTargetType();
    return actual.every((carrier) => carrier !== undefined && rustTargetTypeRefEquals(carrier, stringCarrier))
      ? { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations }
      : { kind: "incompatible", sourceIndex: 0 };
  }
  if (fact.target.form === "call-value-slice" || fact.target.form === "call-value-array" ||
    fact.target.form === "receiver-value-array") {
    const form = fact.target;
    if (actual.length < form.leadingArguments.length) {
      return { kind: "incompatible", sourceIndex: actual.length };
    }
    return { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations };
  }
  if (fact.target.form === "receiver-tagged-array") {
    const form = fact.target;
    if (actual.length < form.leadingArguments.length) {
      return { kind: "incompatible", sourceIndex: actual.length };
    }
    const incompatible = actual.findIndex((carrier, sourceIndex) => {
      if (carrier === undefined) {
        return true;
      }
      if (sourceIndex < form.leadingArguments.length) {
        const target = form.leadingArguments[sourceIndex]!.carrier;
        return !rustTargetTypeRefEquals(carrier, target) &&
          selectRustSourceValueConversion(carrier, target) === undefined;
      }
      const exact = form.alternatives.filter((alternative) =>
        rustTargetTypeRefEquals(carrier, alternative.inputCarrier));
      const convertible = exact.length > 0
        ? []
        : form.alternatives.filter((alternative) =>
            selectRustSourceValueConversion(carrier, alternative.inputCarrier) !== undefined);
      return (exact.length > 0 ? exact : convertible).length !== 1;
    });
    return incompatible < 0
      ? { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations }
      : { kind: "incompatible", sourceIndex: incompatible };
  }
  if (fact.target.form === "call-c-variadic") {
    const form = fact.target;
    if (actual.length < form.fixedArgumentModes.length) {
      return { kind: "incompatible", sourceIndex: actual.length };
    }
    const incompatible = actual.findIndex((carrier, sourceIndex) =>
      sourceIndex >= form.fixedArgumentModes.length &&
      !isRustCVariadicArgumentCarrier(carrier));
    return incompatible < 0
      ? { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations }
      : { kind: "incompatible", sourceIndex: incompatible };
  }
  return { kind: "resolved", carriers: actual as TargetTypeRef[], reconciliations };
}

function selectedCallArgumentTargetCarrier(
  form: RustProviderOperationForm,
  sourceIndex: number,
): TargetTypeRef | undefined {
  if (form.form === "call-str-slice" || form.form === "free-call-str-slice") {
    return rustStringTargetType();
  }
  if (form.form === "call-value-slice" || form.form === "call-value-array" ||
    form.form === "receiver-value-array") {
    return sourceIndex < form.leadingArguments.length
      ? form.leadingArguments[sourceIndex]!.carrier
      : form.elementCarrier;
  }
  if (form.form === "receiver-tagged-array" && sourceIndex < form.leadingArguments.length) {
    return form.leadingArguments[sourceIndex]!.carrier;
  }
  return undefined;
}

function selectedCallReceiverCarrier(
  request: RustCheckedCallSelectionInput,
  form: RustProviderOperationForm,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  if (!providerFormRequiresSourceReceiver(form)) {
    return undefined;
  }
  return selectedCallReceiverValueCarrier(request, context, options);
}

function selectedCallReceiverValueCarrier(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const receiver = request.source.sourceReceiver;
  if (receiver === undefined) {
    return undefined;
  }
  const storedCarrier = resolveRustTargetTypeRef(receiver.expression, context, options);
  const selectedCarrier = selectedSourceValueCarrier(receiver, context, options);
  if (!request.source.optionalChain) {
    return selectedCarrier ?? storedCarrier;
  }
  if (storedCarrier !== undefined && selectedCarrier !== undefined &&
    rustTargetTypeRefEquals(storedCarrier, selectedCarrier)) {
    return selectedCarrier;
  }
  const optionElement = rustOptionElementCarrier(storedCarrier);
  return optionElement !== undefined &&
      (selectedCarrier === undefined || rustTargetTypeRefEquals(optionElement, selectedCarrier))
    ? selectedCarrier ?? optionElement
    : undefined;
}

type RustOptionalCallResult =
  | {
      readonly kind: "resolved";
      readonly resultCarrier: TargetTypeRef;
      readonly fact?: import("../rust-facts/keys.js").RustOptionalChainFact;
    }
  | { readonly kind: "rejected"; readonly message: string };

function selectRustOptionalCallResult(
  request: RustCheckedCallSelectionInput,
  innerResultCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustOptionalCallResult {
  if (!request.source.optionalChain) {
    return { kind: "resolved", resultCarrier: innerResultCarrier };
  }
  const receiver = request.source.sourceReceiver;
  const guard = receiver?.expression ?? request.source.sourceCallee.expression;
  const sourceGuardCarrier = receiver === undefined
    ? resolveRustTargetTypeRef(
        selectedCallCalleeDeclaration(request) ?? request.source.sourceCallee.expression,
        context,
        options,
      )
    : resolveRustTargetTypeRef(
        receiver.expression,
        context,
        options,
      );
  const selectedGuardCarrier = receiver === undefined
    ? resolveRustTargetTypeRef(
        request.sourceSelectedDeclaration,
        context,
        options,
      )
    : selectedCallReceiverValueCarrier(request, context, options);
  if (rustCallableProtocol(selectedGuardCarrier) === undefined &&
    selectedGuardCarrier?.kind !== "function-pointer" && receiver === undefined) {
    return {
      kind: "rejected",
      message: "Optional direct calls require exact callable selected-signature evidence.",
    };
  }
  const selection = selectRustOptionalChain({
    expression: request.source.call,
    guard,
    operationKind: "method",
    sourceGuardCarrier,
    selectedGuardCarrier,
    innerResultCarrier,
  });
  if (selection.kind === "rejected") {
    return selection;
  }
  return selection.kind === "direct"
    ? { kind: "resolved", resultCarrier: selection.resultCarrier }
    : {
        kind: "resolved",
        resultCarrier: selection.fact.resultCarrier,
        fact: selection.fact,
      };
}

function providerFormRequiresSourceReceiver(form: RustProviderOperationForm): boolean {
  return form.form === "method" ||
    form.form === "field" ||
    form.form === "index" ||
    form.form === "free-call" ||
    form.form === "free-call-str-slice" ||
    form.form === "receiver-method" ||
    form.form === "receiver-value-array" ||
    form.form === "receiver-tagged-array" ||
    form.form === "arg-receiver-method" ||
    (form.form === "trait-call" && form.receiverMode !== undefined);
}

interface InstantiatedProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind = RustProviderFactOperationKind,
> {
  readonly template: RustProviderOperationTemplate<OperationKind>;
  readonly substitutions: ReadonlyMap<string, TargetTypeRef>;
}

function instantiateProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind,
>(
  template: RustProviderOperationTemplate<OperationKind>,
  evidence: {
    readonly sourceReceiverCarrier?: TargetTypeRef;
    readonly sourceParameterCarriers?: readonly (TargetTypeRef | undefined)[];
    readonly sourceResultCarrier?: TargetTypeRef;
    readonly directTypeArguments?: ReadonlyMap<string, TargetTypeRef>;
  },
): InstantiatedProviderOperationTemplate<OperationKind> | undefined {
  const parameterNames = new Set(template.typeParameters ?? []);
  if (parameterNames.size === 0) {
    return { template, substitutions: new Map() };
  }
  const bindings = new Map<string, TargetTypeRef>();
  for (const [name, carrier] of evidence.directTypeArguments ?? []) {
    if (parameterNames.has(name) && !mergeTypeBinding(bindings, name, carrier)) {
      return undefined;
    }
  }
  if (!inferTemplateBindings(template.receiverCarrier, evidence.sourceReceiverCarrier, true) ||
    !inferTemplateBindings(template.resultCarrier, evidence.sourceResultCarrier, false)) {
    return undefined;
  }
  for (let index = 0; index < (template.parameterCarriers?.length ?? 0); index += 1) {
    if (!inferTemplateBindings(
      template.parameterCarriers?.[index],
      evidence.sourceParameterCarriers?.[index],
      false,
    )) {
      return undefined;
    }
  }
  if ([...parameterNames].some((name) => !bindings.has(name))) {
    return undefined;
  }
  if (!rustProviderGenericRequirementsAreSatisfied(template.typeRequirements, bindings)) {
    return undefined;
  }
  return {
    template: {
      ...template,
      target: substituteProviderOperationForm(template.target, bindings),
      resultCarrier: substituteRustTargetTypeParameters(template.resultCarrier, bindings),
      ...(template.sourceResultCarrier === undefined
        ? {}
        : {
            sourceResultCarrier: substituteRustTargetTypeParameters(
              template.sourceResultCarrier,
              bindings,
            ),
          }),
      ...(template.parameterCarriers === undefined
        ? {}
        : { parameterCarriers: template.parameterCarriers.map((carrier) =>
            carrier === undefined ? undefined : substituteRustTargetTypeParameters(carrier, bindings)) }),
      ...(template.receiverCarrier === undefined
        ? {}
        : { receiverCarrier: substituteRustTargetTypeParameters(template.receiverCarrier, bindings) }),
      ...(template.targetTypeArguments === undefined
        ? {}
        : {
            targetTypeArguments: template.targetTypeArguments.map((carrier) =>
              substituteRustTargetTypeParameters(carrier, bindings)),
          }),
      ...(template.resultConversion === undefined
        ? {}
        : {
            resultConversion: substituteRustValueConversion(
              template.resultConversion,
              bindings,
            ),
          }),
      typeParameters: [],
      typeRequirements: [],
    },
    substitutions: bindings,
  };

  function inferTemplateBindings(
    pattern: TargetTypeRef | undefined,
    actual: TargetTypeRef | undefined,
    reconcileKnownBindings: boolean,
  ): boolean {
    if (pattern === undefined || !rustTargetTypeContainsTypeParameter(pattern, parameterNames)) {
      return true;
    }
    const selectedNames = reconcileKnownBindings
      ? parameterNames
      : new Set([...parameterNames].filter((name) => !bindings.has(name)));
    if (!rustTargetTypeContainsTypeParameter(pattern, selectedNames)) {
      return true;
    }
    if (actual === undefined) {
      return false;
    }
    const inferred = inferRustTargetTypeParameterBindings(pattern, actual, selectedNames);
    if (inferred === undefined) {
      return false;
    }
    for (const [name, carrier] of inferred) {
      if (!mergeTypeBinding(bindings, name, carrier)) {
        return false;
      }
    }
    return true;
  }
}

function mergeTypeBinding(
  bindings: Map<string, TargetTypeRef>,
  name: string,
  carrier: TargetTypeRef,
): boolean {
  const existing = bindings.get(name);
  if (existing !== undefined) {
    return rustTargetTypeRefEquals(existing, carrier);
  }
  bindings.set(name, carrier);
  return true;
}

function substituteProviderOperationForm(
  form: RustProviderOperationForm,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
): RustProviderOperationForm {
  switch (form.form) {
    case "call-value-slice":
    case "call-value-array":
    case "receiver-value-array":
      return {
        ...form,
        leadingArguments: form.leadingArguments.map((argument) => ({
          ...argument,
          carrier: substituteRustTargetTypeParameters(argument.carrier, substitutions),
        })),
        elementCarrier: substituteRustTargetTypeParameters(form.elementCarrier, substitutions),
      };
    case "receiver-tagged-array":
      return {
        ...form,
        leadingArguments: form.leadingArguments.map((argument) => ({
          ...argument,
          carrier: substituteRustTargetTypeParameters(argument.carrier, substitutions),
        })),
        elementCarrier: substituteRustTargetTypeParameters(form.elementCarrier, substitutions),
        alternatives: form.alternatives.map((alternative) => ({
          ...alternative,
          inputCarrier: substituteRustTargetTypeParameters(alternative.inputCarrier, substitutions),
        })),
      };
    case "trait-call":
    case "trait-associated-value":
      return {
        ...form,
        owner: substituteRustTargetTypeParameters(form.owner, substitutions),
        traitTypeArguments: form.traitTypeArguments.map((argument) =>
          substituteRustTargetTypeParameters(argument, substitutions)),
      };
    default:
      return form;
  }
}

function finalizeProviderOperationFact(
  template: RustProviderOperationTemplate,
  sourceArgumentCarriers: readonly TargetTypeRef[],
  sourceReceiverCarrier: TargetTypeRef | undefined,
): Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> | undefined {
  const abi = finalizeRustProviderOperationAbi({
    operationKind: template.operationKind,
    form: template.target,
    ...(sourceReceiverCarrier === undefined ? {} : { sourceReceiverCarrier }),
    sourceArgumentCarriers,
    declaredSourceArgumentCarriers: template.parameterCarriers,
    ...(template.compileTimeSourceArgumentIndexes === undefined
      ? {}
      : { compileTimeSourceArgumentIndexes: template.compileTimeSourceArgumentIndexes }),
    resultCarrier: template.resultCarrier,
    ...(template.targetTypeArguments === undefined
      ? {}
      : { targetTypeArguments: template.targetTypeArguments }),
    ...(template.resultConversion === undefined ? {} : { resultConversion: template.resultConversion }),
    isAsync: template.isAsync,
    isFallible: template.isFallible,
    ...(template.errorBoundary === "none" ? {} : { errorBoundary: template.errorBoundary }),
    isUnsafe: template.isUnsafe,
  });
  if (abi === undefined) {
    return undefined;
  }
  return {
    kind: "provider-operation",
    operationId: template.operationId,
    resultCarrier: abi.result.kind === "async" ? abi.result.futureCarrier : abi.result.carrier,
    ...(template.sourceResultCarrier === undefined
      ? {}
      : { sourceResultCarrier: template.sourceResultCarrier }),
    abi,
  };
}

function checkedCallIsConstruction(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
): boolean {
  const call = asNode(request.source.call, context);
  const callee = asNode(request.source.sourceCallee.expression, context);
  return call !== undefined && (
    context.ast.kindName(call) === "KindNewExpression" ||
    (context.ast.kindName(call) === "KindCallExpression" &&
      callee !== undefined && context.ast.kindName(callee) === "KindSuperKeyword")
  );
}

export function selectRustCheckedDelete(
  request: RustCheckedDeleteSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const identity = resolveSelectedJsSourceMember(
    context,
    request.sourceSelectedDeclaration,
    options.sourceProfiles,
  );
  if (!options.jsEnabled || identity?.ownerName !== "Array" ||
    identity.memberName !== "index") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_DELETE_SELECTION_UNSUPPORTED",
      "delete requires the exact mutable JavaScript Array index signature selected by TSTS.",
    );
  }
  const receiverCarrier = resolveRustTargetTypeRef(request.receiver, context, options);
  const selectedIndexCarrier = resolveRustTargetTypeRef(request.index, context, options);
  const int32Carrier = rustSourcePrimitiveTargetType("int32");
  const indexCarrier = normalizeSelectedLiteralCarrier(
    request.index,
    selectedIndexCarrier,
    int32Carrier,
    context,
    options,
  );
  const selection = selectJsSurfaceOperation({
    ownerName: identity.ownerName,
    memberName: identity.memberName,
    operationKind: "delete",
    ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    argumentCarriers: [indexCarrier],
  });
  if (selection?.fact.kind !== "provider-operation") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_DELETE_CARRIER_UNSUPPORTED",
      "The selected JavaScript Array deletion has no closed Rust receiver and index carriers.",
    );
  }
  const fact = finalizeProviderOperationFromSubjects(
    selection.fact,
    request.receiver,
    [request.index],
    context,
    options,
  );
  if (fact === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_DELETE_ABI_INCOMPLETE",
      "The selected JavaScript Array deletion cannot finalize one total Rust operation ABI.",
    );
  }
  return acceptRustOperation(request.expression, fact, context, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    ...(request.sourceSelectedSymbol === undefined
      ? {}
      : { sourceSelectedSymbol: request.sourceSelectedSymbol }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceSelectedDeclaration: request.sourceSelectedDeclaration }),
  });
}

function selectExternalProjectFieldAccess(
  request: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const externalField = options.projectTypes.externalFieldForReceiver(
    request.sourceSelectedDeclaration,
    selectedReceiverCarrier,
  );
  if (externalField === undefined || selectedReceiverCarrier === undefined) {
    return undefined;
  }
  const operationId = sourceOperationId(context, externalField.field.declaration, "external-field");
  const readSlot = options.projectTypes.memberSlotName(
    externalField.field.declaration,
    "read",
  );
  const writeSlot = options.projectTypes.memberSlotName(
    externalField.field.declaration,
    "write",
  );
  if (readSlot === undefined || writeSlot === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_EXTERNAL_PROJECT_FIELD_SLOT_IDENTITY_MISSING",
      "Selected external project field has no deterministic Rust dispatch-slot identity.",
    );
  }
  return acceptRustMemberOperation(request, "property", {
    kind: "source-field",
    operationId,
    receiverCarrier: selectedReceiverCarrier,
    storage: "project-object",
    storageIndex: externalField.field.storageIndex,
    resultCarrier: externalField.field.carrier,
    dispatch: {
      read: readSlot,
      write: writeSlot,
      ownerCarrier: externalField.ownerCarrier,
    },
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: externalField.field.declaration,
    sourceResultType: request.sourceResultType,
  });
}

export function selectRustCheckedPropertyAccess(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const selectedReceiverCarrier = selectedMemberReceiverCarrier(request, context, options);
  const runtimeReceiverCarrier = resolveRustTargetTypeRef(
    request.receiver,
    context,
    options,
  );
  if (request.optionalChain === true && selectedReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_OPTIONAL_CHAIN_EVIDENCE_MISSING", "Optional-chain property access has no exact TSTS-selected non-null receiver type.");
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("property");
  }
  const projectMethodProperty = selectProjectSourceMethodProperty(
    request,
    selectedReceiverCarrier,
    context,
    options,
  );
  if (projectMethodProperty !== undefined) {
    return projectMethodProperty;
  }
  if (selectedDeclarationIsCallable(request.sourceSelectedDeclaration, context)) {
    return acceptDeclarationOperation("property");
  }
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.sourceSelectedSymbol, precision: "exact" },
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked property access carries conflicting selected provider declaration identities.");
  }
  if (providerEvidence.kind === "selected") {
    if (tsonicFixedArrayProviderMember(providerEvidence.identity) === "length") {
      return selectRustFixedArrayLengthProperty(
        request,
        selectedReceiverCarrier,
        context,
        options,
      );
    }
    return mapProviderCheckedOperation(request.expression, providerEvidence.identity, "property", context, options, request.receiver, [], request, selectedReceiverCarrier);
  }

  const sourceProfileMembers = resolveSelectedSourceProfilePropertyMembers(
    context,
    request.expression,
    request.sourceSelectedSymbol,
    request.sourceSelectedDeclaration,
    options.sourceProfiles,
  );
  if (sourceProfileMembers !== undefined) {
    const generator = selectRustGeneratorSourceProperty({
      sourceMembers: sourceProfileMembers.members,
      ...(runtimeReceiverCarrier === undefined
        ? {}
        : { receiverCarrier: runtimeReceiverCarrier }),
    });
    if (generator.kind === "rejected") {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_GENERATOR_SOURCE_PROPERTY_NOT_CLOSED",
        generator.message,
      );
    }
    if (generator.kind === "resolved") {
      const fact = finalizeProviderOperationFromSubjects(
        generator.template,
        request.receiver,
        [],
        context,
        options,
        runtimeReceiverCarrier,
      );
      if (fact === undefined) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_GENERATOR_SOURCE_PROPERTY_ABI_INCOMPLETE",
          "The exact selected iterator-result property cannot finalize one total Rust operation ABI.",
        );
      }
      return acceptRustMemberOperation(request, "property", fact, context, options, {
        sourceExpression: request.expression,
        sourceReceiver: request.receiver,
        sourceSelectedSymbol: request.sourceSelectedSymbol,
        sourceSelectedDeclaration: request.sourceSelectedDeclaration,
        sourceResultType: request.sourceResultType,
      });
    }
  }

  const externalProjectField = selectExternalProjectFieldAccess(
    request,
    selectedReceiverCarrier,
    context,
    options,
  );
  if (externalProjectField !== undefined) {
    return externalProjectField;
  }

  const jsIdentity = resolveSelectedJsSourceMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (jsIdentity !== undefined) {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.expression, context, "RUST_JS_SURFACE_REQUIRED", "The selected property belongs to the explicit JavaScript source profile, which is not active.");
    }
    const receiverCarrier = selectedReceiverCarrier;
    const selection = selectJsSurfaceOperation({
      ownerName: jsIdentity.ownerName,
      memberName: jsIdentity.memberName,
      operationKind: "property",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SELECTED_OPERATION_UNSUPPORTED",
        `The selected JavaScript property '${jsIdentity.ownerName}.${jsIdentity.memberName}' has no closed Rust operation row for this receiver carrier.`,
      );
    }
    const fact = finalizeProviderOperationFromSubjects(selection.fact, request.receiver, [], context, options, selectedReceiverCarrier);
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `The selected JavaScript property '${jsIdentity.ownerName}.${jsIdentity.memberName}' cannot finalize one total Rust operation ABI.`);
    }
    return acceptRustMemberOperation(request, "property", fact, context, options, {
      sourceExpression: request.expression,
      sourceReceiver: request.receiver,
      sourceSelectedSymbol: request.sourceSelectedSymbol,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceResultType: request.sourceResultType,
    });
  }

  const projectAccessor = selectProjectSourceAccessor(
    request,
    context,
    options,
  );
  if (projectAccessor !== undefined) {
    return projectAccessor;
  }

  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    const declaration = request.sourceSelectedDeclaration;
    const storage = rustProjectStaticFieldStorage(
      declaration,
      context.ast,
      options.projectTypes.memberSlotName(declaration, "static"),
    );
    if (storage !== undefined) {
      const owner = options.projectTypes.definitionContainingDeclaration(declaration);
      if (owner?.kind !== "class" || request.sourceReceiverValueDeclaration !== owner.declaration) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_STATIC_FIELD_RECEIVER_NOT_EXACT",
          "Project static-field access requires exact TSTS-selected receiver value evidence for the declaring class.",
        );
      }
      const sourceFieldType = Node_Type(context.ast, declaration) ??
        (request.optionalChain === true ? undefined : request.sourceResultType);
      const resultCarrier = resolveRustTargetTypeRef(sourceFieldType, context, options);
      if (resultCarrier === undefined) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_STATIC_FIELD_RESULT_NOT_CLOSED",
          "Selected project static field has no exact Rust result carrier.",
        );
      }
      const operationId = sourceOperationId(context, declaration, "static-field");
      return acceptRustMemberOperation(request, "property", {
        kind: "source-static-field",
        operationId,
        storageFileName: storage.fileName,
        storageName: storage.targetName,
        resultCarrier,
      }, context, options, {
        sourceExpression: request.expression,
        sourceReceiver: request.receiver,
        sourceSelectedSymbol: request.sourceSelectedSymbol,
        sourceSelectedDeclaration: declaration,
        sourceResultType: request.sourceResultType,
      });
    }
  }

  const structuralProperty = selectStructuralSourceProperty(
    request,
    selectedReceiverCarrier,
    context,
    options,
  );
  if (structuralProperty !== undefined) {
    return structuralProperty;
  }

  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    const declaration = request.sourceSelectedDeclaration;
    const memberName = context.ast.text(context.ast.name(declaration));
    if (context.ast.kindName(declaration) === "KindEnumMember") {
      const enumDeclaration = context.ast.parent(declaration);
      const enumName = enumDeclaration === undefined
        ? ""
        : context.ast.text(context.ast.name(enumDeclaration));
      const enumFileName = enumDeclaration === undefined
        ? ""
        : context.ast.getFileName(context.ast.getSourceFile(enumDeclaration));
      const resultCarrier = enumName.length === 0 || enumFileName.length === 0
        ? undefined
        : rustSourceTypeCarrier(enumFileName, enumName, "enum");
      if (memberName.length > 0 && resultCarrier !== undefined) {
        const operationId = sourceOperationId(context, declaration, "enum-member");
        return acceptRustMemberOperation(request, "property", {
          kind: "source-enum-member",
          operationId,
          name: memberName,
          resultCarrier,
        }, context, options, {
          sourceExpression: request.expression,
          sourceReceiver: request.receiver,
          sourceSelectedSymbol: request.sourceSelectedSymbol,
          sourceSelectedDeclaration: declaration,
          sourceResultType: request.sourceResultType,
        });
      }
    }
    const field = rustProjectObjectField(declaration, context.ast);
    const sourceFieldType = Node_Type(context.ast, declaration) ??
      (request.optionalChain === true ? undefined : request.sourceResultType);
    const declaredCarrier = resolveRustTargetTypeRef(sourceFieldType, context, options);
    const resultCarrier = declaredCarrier === undefined || selectedReceiverCarrier === undefined
      ? undefined
      : options.projectTypes.instantiateMemberCarrier(
          declaration,
          selectedReceiverCarrier,
          declaredCarrier,
        );
    if (field !== undefined && resultCarrier !== undefined && selectedReceiverCarrier !== undefined) {
      const operationId = sourceOperationId(context, declaration, "field");
      const owner = options.projectTypes.definitionContainingDeclaration(declaration);
      const storageIndex = field.storageIndex +
        (owner === undefined
          ? 0
          : options.projectTypes.externalBaseForDefinition(owner)?.fields.length ?? 0);
      const ownerRelationship = owner === undefined || selectedReceiverCarrier === undefined
        ? undefined
        : options.projectTypes.relationship(selectedReceiverCarrier, owner);
      const ownerCarrier = ownerRelationship?.kind === "related"
        ? ownerRelationship.targetType
        : undefined;
      const readSlot = owner !== undefined && options.projectTypes.isPolymorphic(owner)
        ? options.projectTypes.memberSlotName(declaration, "read")
        : undefined;
      const writeSlot = readSlot === undefined
        ? undefined
        : options.projectTypes.memberSlotName(declaration, "write");
      if (owner !== undefined && options.projectTypes.isPolymorphic(owner) &&
        (readSlot === undefined || writeSlot === undefined || ownerCarrier === undefined)) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_PROJECT_FIELD_SLOT_IDENTITY_MISSING",
          "Selected project field has no deterministic Rust dispatch-slot identity.",
        );
      }
      return acceptRustMemberOperation(request, "property", {
        kind: "source-field",
        operationId,
        receiverCarrier: selectedReceiverCarrier,
        storage: "project-object",
        storageIndex,
        resultCarrier,
        ...(readSlot === undefined || writeSlot === undefined
          ? {}
          : { dispatch: { read: readSlot, write: writeSlot, ownerCarrier: ownerCarrier! } }),
      }, context, options, {
        sourceExpression: request.expression,
        sourceReceiver: request.receiver,
        sourceSelectedSymbol: request.sourceSelectedSymbol,
        sourceSelectedDeclaration: declaration,
        sourceResultType: request.sourceResultType,
      });
    }
  }

  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("property");
  }
  return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_EVIDENCE_MISSING", "Checked property access has no selected provider, source-profile, or project-source declaration evidence.");
}

function selectProjectSourceMethodProperty(
  request: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const declaration = request.sourceSelectedDeclaration;
  const kind = declaration === undefined ? undefined : context.ast.kindName(declaration);
  if (!isProjectSourceDeclaration(context, declaration) ||
    (kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature")) {
    return undefined;
  }
  if (context.ast.hasModifierKind(declaration, "static")) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_STATIC_METHOD_PROPERTY_UNSUPPORTED",
      "Static project methods require a separate exact constructor-object property-storage contract.",
    );
  }
  if (request.accessMode === "delete") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_DELETE_UNSUPPORTED",
      "Project method properties cannot be deleted without an exact optional callable-property contract.",
    );
  }
  const owner = options.projectTypes.definitionContainingDeclaration(declaration);
  const relationship = owner === undefined || selectedReceiverCarrier === undefined
    ? undefined
    : options.projectTypes.relationship(selectedReceiverCarrier, owner);
  if (owner === undefined || selectedReceiverCarrier === undefined ||
    relationship?.kind !== "related") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_RECEIVER_NOT_CLOSED",
      "Selected project method property has no exact receiver-to-declaration relationship.",
    );
  }
  const needsRead = request.accessMode === "read" || request.accessMode === "read-write";
  const needsWrite = request.accessMode === "write" || request.accessMode === "read-write";
  const readCarrier = needsRead
    ? resolveRustTargetTypeRef(request.sourceReadType, context, options)
    : undefined;
  const writeCarrier = needsWrite
    ? resolveRustTargetTypeRef(request.sourceWriteType, context, options)
    : undefined;
  const resultCarrier = resolveRustTargetTypeRef(request.sourceResultType, context, options) ??
    readCarrier ?? writeCarrier;
  const callableCarrier = readCarrier ?? writeCarrier;
  if (callableCarrier === undefined || resultCarrier === undefined ||
    rustCallableProtocol(callableCarrier) === undefined ||
    !rustTargetTypeRefEquals(callableCarrier, resultCarrier) ||
    (readCarrier !== undefined && !rustTargetTypeRefEquals(readCarrier, callableCarrier)) ||
    (writeCarrier !== undefined && !rustTargetTypeRefEquals(writeCarrier, callableCarrier))) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_CALLABLE_NOT_CLOSED",
      "Selected project method property has no single exact runtime callable carrier for its checked access mode.",
    );
  }
  const methodTypeParameters = context.ast.typeParameters(declaration);
  const parameters = context.ast.parameters(declaration);
  const parameterAbis = parameters.map((parameter) => parameter === undefined
    ? undefined
    : options.sourceCallableAbi.resolveParameterAbi(parameter, context, options));
  const callable = rustCallableProtocol(callableCarrier)!;
  if (!isDenseDataArray(methodTypeParameters) || methodTypeParameters.length !== 0 ||
    !isDenseDataArray(parameters) || parameterAbis.some((parameter) =>
      parameter === undefined || parameter.form !== "required" || parameter.mode !== "value") ||
    parameterAbis.length !== callable.parameters.length ||
    parameterAbis.some((parameter, index) =>
      !rustTargetTypeRefEquals(parameter!.parameterCarrier, callable.parameters[index]))) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_PROPERTY_ABI_UNSUPPORTED",
      "Mutable project method properties require one non-generic required-parameter value ABI.",
    );
  }
  const implementation = context.source.navigation.callableImplementation(declaration);
  const concreteDeclaration = implementation.kind === "resolved"
    ? implementation.implementation.declaration
    : declaration;
  const storageOwner = options.projectTypes.definitionContainingDeclaration(concreteDeclaration);
  const dispatchSlot = options.projectTypes.memberSlotName(declaration, "method-write");
  const storageName = storageOwner === undefined
    ? undefined
    : options.projectTypes.fieldStorageName(storageOwner, concreteDeclaration);
  if (dispatchSlot === undefined || (storageOwner?.kind === "class" && storageName === undefined)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_PROPERTY_STORAGE_MISSING",
      "Selected project method property has no deterministic replacement slot.",
    );
  }
  const registration = options.projectMethodProperties.record(
    declaration,
    request.accessMode,
  );
  if (registration.kind === "rejected") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_METHOD_PROPERTY_CONFLICT",
      registration.reason,
    );
  }
  return acceptRustMemberOperation(request, "property", {
    kind: "source-method-property",
    operationId: sourceOperationId(context, declaration, "method-property"),
    declaration,
    receiverCarrier: selectedReceiverCarrier,
    callableCarrier,
    ...(needsWrite
      ? {
          write: {
            dispatchSlot,
            ownerCarrier: relationship.targetType,
            ...(storageName === undefined ? {} : { storageName }),
          },
        }
      : {}),
    resultCarrier,
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: declaration,
    sourceResultType: request.sourceResultType,
  });
}

function selectProjectSourceAccessor(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const readDeclaration = isProjectAccessorDeclaration(
    request.sourceSelectedReadDeclaration,
    "KindGetAccessor",
    context,
  )
    ? request.sourceSelectedReadDeclaration
    : undefined;
  const writeDeclaration = isProjectAccessorDeclaration(
    request.sourceSelectedWriteDeclaration,
    "KindSetAccessor",
    context,
  )
    ? request.sourceSelectedWriteDeclaration
    : undefined;
  const selectedKind = request.sourceSelectedDeclaration === undefined
    ? undefined
    : context.ast.kindName(request.sourceSelectedDeclaration);
  const selectedAccessor = isProjectSourceDeclaration(
    context,
    request.sourceSelectedDeclaration,
  ) && (selectedKind === "KindGetAccessor" || selectedKind === "KindSetAccessor");
  if (!selectedAccessor && readDeclaration === undefined && writeDeclaration === undefined) {
    return undefined;
  }
  const needsRead = request.accessMode === "read" || request.accessMode === "read-write";
  const needsWrite = request.accessMode === "write" || request.accessMode === "read-write";
  if (request.accessMode === "delete" ||
    (needsRead && readDeclaration === undefined) ||
    (needsWrite && writeDeclaration === undefined)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_EVIDENCE_MISSING",
      "Project accessor operation requires the exact TSTS-selected getter and setter declarations for its checked access mode.",
    );
  }
  const declarations = [readDeclaration, writeDeclaration].filter(
    (declaration): declaration is Node => declaration !== undefined,
  );
  const owner = declarations[0] === undefined
    ? undefined
    : context.ast.parent(declarations[0]);
  if (owner === undefined || declarations.some((declaration) =>
    context.ast.parent(declaration) !== owner)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_OWNER_CONFLICT",
      "Selected accessor declarations do not belong to one exact project-source owner.",
    );
  }
  const staticAccess = context.ast.hasModifierKind(declarations[0]!, "static");
  if (declarations.some((declaration) =>
    context.ast.hasModifierKind(declaration, "static") !== staticAccess)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_STATIC_CONFLICT",
      "Selected getter and setter declarations disagree on static ownership.",
    );
  }
  const readCarrier = readDeclaration === undefined
    ? undefined
    : context.facts.get(readDeclaration, rustSourceCallableReturnFactKey)?.returnCarrier ??
      resolveRustTargetTypeRef(Node_Type(context.ast, readDeclaration), context, options) ??
      resolveRustTargetTypeRef(request.sourceReadType, context, options);
  const writeParameters = writeDeclaration === undefined
    ? undefined
    : context.ast.parameters(writeDeclaration);
  const writeParameter = writeParameters !== undefined &&
      isDenseDataArray(writeParameters) && writeParameters.length === 1
    ? writeParameters[0]
    : undefined;
  const writeCarrier = writeDeclaration === undefined || writeParameter === undefined
    ? undefined
    : options.sourceCallableAbi.resolveParameterAbi(
        writeParameter,
        context,
        options,
      )?.valueCarrier ??
      resolveRustTargetTypeRef(Node_Type(context.ast, writeParameter), context, options) ??
      resolveRustTargetTypeRef(request.sourceWriteType, context, options);
  if ((needsRead && readCarrier === undefined) ||
    (needsWrite && writeCarrier === undefined)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_CARRIER_MISSING",
      "Selected project accessor has no closed Rust carrier for its exact checked read or write type.",
    );
  }
  const readMethod = readDeclaration === undefined
    ? undefined
    : options.projectTypes.memberSlotName(readDeclaration, "read");
  const writeMethod = writeDeclaration === undefined
    ? undefined
    : options.projectTypes.memberSlotName(writeDeclaration, "write");
  if ((needsRead && readMethod === undefined) ||
    (needsWrite && writeMethod === undefined)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_SLOT_MISSING",
      "Selected project accessor has no deterministic Rust declaration slot.",
    );
  }
  const typeDefinition = options.projectTypes.definitionContainingDeclaration(
    declarations[0]!,
  );
  const staticCarrier = !staticAccess || typeDefinition === undefined
    ? undefined
    : options.projectTypes.openCarrier(typeDefinition);
  if (staticAccess && staticCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_STATIC_CARRIER_MISSING",
      "Static project accessor has no exact generated Rust owner carrier.",
    );
  }
  const resultCarrier = readCarrier ?? writeCarrier;
  if (resultCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROJECT_ACCESSOR_RESULT_MISSING",
      "Selected project accessor has no exact Rust operation result carrier.",
    );
  }
  const operationId = `tsonic.rust.source.accessor:${request.accessMode}:${[
    readDeclaration === undefined
      ? "-"
      : sourceOperationId(context, readDeclaration, "accessor-read"),
    writeDeclaration === undefined
      ? "-"
      : sourceOperationId(context, writeDeclaration, "accessor-write"),
  ].join(":")}`;
  return acceptRustMemberOperation(request, "property", {
    kind: "source-accessor",
    operationId,
    accessMode: request.accessMode,
    receiver: staticAccess
      ? { kind: "static", typeCarrier: staticCarrier! }
      : { kind: "instance" },
    ...(readMethod === undefined || readCarrier === undefined
      ? {}
      : { read: { method: readMethod, resultCarrier: readCarrier } }),
    ...(writeMethod === undefined || writeCarrier === undefined
      ? {}
      : { write: { method: writeMethod, valueCarrier: writeCarrier } }),
    resultCarrier,
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceSelectedReadDeclaration: readDeclaration,
    sourceSelectedWriteDeclaration: writeDeclaration,
    sourceResultType: request.sourceResultType,
  });
}

function isProjectAccessorDeclaration(
  declaration: Node | undefined,
  kind: "KindGetAccessor" | "KindSetAccessor",
  context: RustOperationPolicyContext,
): declaration is Node {
  return isProjectSourceDeclaration(context, declaration) &&
    context.ast.kindName(declaration) === kind;
}

function selectStructuralSourceProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  if (receiverCarrier === undefined) {
    return undefined;
  }
  const selectedDeclarations = selectedPropertyDeclarations(request, context, options);
  const sourceUnion = options.sourceTypes.sourceUnionForCarrier(receiverCarrier);
  if (sourceUnion !== undefined) {
    if (selectedDeclarations === undefined || selectedDeclarations.length === 0) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_PROPERTY_IDENTITY_MISSING",
        "Runtime-union property access requires exact selected source declarations.",
      );
    }
    const selectedVariantIndexes = selectedSourceUnionVariantIndexes(
      request,
      sourceUnion,
      context,
      options,
    );
    if (selectedVariantIndexes === undefined || selectedVariantIndexes.length === 0) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_REFINEMENT_MISSING",
        "Runtime-union property access requires exact TSTS-selected receiver refinement.",
      );
    }
    const selectedIndexes = new Set(selectedVariantIndexes);
    const fields = sourceUnion.variants.map((variant, index) => {
      if (!selectedIndexes.has(index)) {
        return undefined;
      }
      const matches = variant.shape?.fields.filter((field) =>
        field.declarations.some((declaration) => selectedDeclarations.includes(declaration))) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    });
    if (selectedVariantIndexes.some((index) => fields[index] === undefined)) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_PROPERTY_NOT_TOTAL",
        "The exact selected source property is not represented by every selected runtime-union arm.",
      );
    }
    const selectedFields = selectedVariantIndexes.map((index) => fields[index]!);
    const resultCarrier = selectedFields[0]?.resultCarrier;
    if (resultCarrier === undefined ||
      selectedFields.some((field) =>
        !rustTargetTypeRefEquals(field.resultCarrier, resultCarrier))) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_PROPERTY_RESULT_NOT_CLOSED",
        "The exact selected runtime-union property does not have one closed Rust result carrier.",
      );
    }
    const operationId = sourceDeclarationsOperationId(
      context,
      selectedDeclarations,
      "union-field",
    );
    if (operationId === undefined) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SOURCE_UNION_PROPERTY_IDENTITY_MISSING",
        "Runtime-union property access has no deterministic declaration identity.",
      );
    }
    return acceptRustMemberOperation(request, "property", {
      kind: "source-union-field",
      operationId,
      unionCarrier: receiverCarrier,
      selectedVariantIndexes,
      variants: sourceUnion.variants.map((variant, index) => ({
        name: variant.name,
        carrier: variant.carrier,
        ...(fields[index] === undefined
          ? {}
          : {
              field: {
                storage: variant.shape!.storage,
                storageIndex: fields[index]!.storageIndex,
              },
            }),
      })),
      resultCarrier,
    }, context, options, {
      sourceExpression: request.expression,
      sourceReceiver: request.receiver,
      ...(request.sourceSelectedSymbol === undefined
        ? {}
        : { sourceSelectedSymbol: request.sourceSelectedSymbol }),
      ...(request.sourceSelectedDeclaration === undefined
        ? {}
        : { sourceSelectedDeclaration: request.sourceSelectedDeclaration }),
      sourceResultType: request.sourceResultType,
    });
  }

  if (selectedDeclarations === undefined) {
    return undefined;
  }
  const matches = selectedDeclarations
    .map((declaration) =>
      options.sourceTypes.structuralFieldProjectionForDeclaration(declaration, receiverCarrier))
    .filter((projection): projection is NonNullable<typeof projection> => projection !== undefined);
  const distinct = matches.filter((projection, index) => matches.indexOf(projection) === index);
  if (distinct.length === 0) {
    return undefined;
  }
  if (distinct.length !== 1) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_STRUCTURAL_PROPERTY_AMBIGUOUS",
      "Selected structural property evidence resolves to more than one Rust storage field.",
    );
  }
  const { field, shape } = distinct[0]!;
  const resultCarrier = field.resultCarrier;
  const operationId = sourceDeclarationsOperationId(context, field.declarations, "field");
  if (operationId === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_STRUCTURAL_PROPERTY_RESULT_NOT_CLOSED",
      "Selected structural property evidence has no exact Rust result carrier.",
    );
  }
  return acceptRustMemberOperation(request, "property", {
    kind: "source-field",
    operationId,
    receiverCarrier,
    storage: shape.storage,
    storageIndex: field.storageIndex,
    resultCarrier,
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    ...(request.sourceSelectedSymbol === undefined
      ? {}
      : { sourceSelectedSymbol: request.sourceSelectedSymbol }),
    ...(request.sourceSelectedDeclaration === undefined
      ? {}
      : { sourceSelectedDeclaration: request.sourceSelectedDeclaration }),
    sourceResultType: request.sourceResultType,
  });
}

function selectedPropertyDeclarations(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly Node[] | undefined {
  const declarations: Node[] = [];
  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    declarations.push(request.sourceSelectedDeclaration!);
  }
  if (request.sourceSelectedSymbol !== undefined) {
    const selected = options.sourceTypes.declarationsForSelectedSymbol(
      request.sourceSelectedSymbol,
    );
    if (selected === undefined) {
      if (declarations.length === 0) {
        return undefined;
      }
    } else {
      for (const declaration of selected) {
        if (isProjectSourceDeclaration(context, declaration) && !declarations.includes(declaration)) {
          declarations.push(declaration);
        }
      }
    }
  }
  return Object.freeze(declarations);
}

function selectedSourceUnionVariantIndexes(
  request: RustCheckedPropertySelectionInput,
  union: RustSourceUnion,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly number[] | undefined {
  const all = Object.freeze(union.variants.map((_, index) => index));
  const selectedReceiverType = request.sourceReceiverType;
  if (selectedReceiverType !== undefined) {
    const selectedRefinement = context.source.semantics
      .forNode(request.receiver)
      .selectTypeRefinement(union.sourceType, selectedReceiverType);
    if (selectedRefinement.kind === "exact") {
      return all;
    }
    if (selectedRefinement.kind === "members") {
      const direct = options.sourceTypes.sourceUnionVariantIndexesForTypes(
        union.carrier,
        selectedRefinement.types,
      );
      if (direct !== undefined) {
        return direct;
      }
    }
  }
  const refinement = context.source.semantics.selectValueTypeRefinement(request.receiver);
  if (refinement.kind !== "resolved") {
    return undefined;
  }
  if (refinement.refinement.kind === "exact" &&
    refinement.declaredType === union.sourceType) {
    return all;
  }
  return refinement.refinement.kind === "members"
    ? options.sourceTypes.sourceUnionVariantIndexesForTypes(
        union.carrier,
        refinement.refinement.types,
      )
    : undefined;
}

function sourceDeclarationsOperationId(
  context: RustOperationPolicyContext,
  declarations: readonly Node[],
  kind: "field" | "union-field",
): string | undefined {
  if (declarations.length === 0) {
    return undefined;
  }
  const identities = declarations.map((declaration) => {
    const fileName = context.ast.getFileName(context.ast.getSourceFile(declaration));
    const start = context.ast.pos(declaration);
    const end = context.ast.end(declaration);
    return fileName.length === 0 || start < 0 || end < start
      ? undefined
      : `${fileName}:${start}:${end}`;
  });
  if (identities.some((identity) => identity === undefined)) {
    return undefined;
  }
  const unique = [...new Set(identities as readonly string[])].sort();
  return `tsonic.rust.source.${kind}:${JSON.stringify(unique)}`;
}

function selectRustFixedArrayLengthProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const fixedArray = rustFixedArrayCarrierValue(receiverCarrier);
  if (fixedArray === undefined || request.accessMode !== "read") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_LENGTH_NOT_CLOSED",
      "The selected FixedArray.length access requires one exact fixed-array receiver and readonly access.",
    );
  }
  const resultCarrier = rustSourcePrimitiveTargetType("int32");
  const template: RustProviderOperationTemplate = {
    kind: "provider-operation",
    operationId: "tsonic.rust.fixed-array.length",
    operationKind: "property",
    target: { form: "receiver-method", name: "len" },
    resultCarrier,
    parameterCarriers: [],
    resultConversion: rustUsizeToInt32ValueConversion,
    isAsync: false,
    isFallible: false,
    errorBoundary: "none",
  };
  const fact = finalizeProviderOperationFromSubjects(
    template,
    request.receiver,
    [],
    context,
    options,
    receiverCarrier,
  );
  if (fact === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_LENGTH_ABI_INCOMPLETE",
      "The selected FixedArray.length access cannot finalize one total Rust len operation ABI.",
    );
  }
  return acceptRustMemberOperation(
    request,
    "property",
    fact,
    context,
    options,
    {
      sourceExpression: request.expression,
      sourceReceiver: request.receiver,
      sourceSelectedSymbol: request.sourceSelectedSymbol,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceResultType: request.sourceResultType,
    },
  );
}

function selectRustFixedArrayElementAccess(
  request: RustCheckedElementSelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const fixedArray = rustFixedArrayCarrierValue(receiverCarrier);
  if (fixedArray === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_RECEIVER_NOT_CLOSED",
      "The selected FixedArray index access has no exact fixed-array receiver carrier.",
    );
  }
  const index = request.sourceSelectedElementIndex;
  if (index !== undefined) {
    if (index < 0 || index >= fixedArray.length) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN",
        "Fixed-array element access carries a TSTS-selected ordinal outside the finalized array bounds.",
      );
    }
    return acceptRustMemberOperation(request, "indexer", {
      kind: "fixed-index",
      operationId: "tsonic.rust.fixed-array.index",
      index,
    }, context, options, elementProvenance(request), fixedArray.element);
  }
  if (!isRustCopyCarrier(fixedArray.element)) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_DYNAMIC_INDEX_REQUIRES_COPY",
      "Dynamic fixed-array element access requires an exact Copy element carrier so a borrowed Rust index result can preserve source value semantics.",
    );
  }
  const dynamicIndexCarrier = selectedValueCarrier(
    request.argument,
    request.sourceArgumentType,
    context,
    options,
  );
  const normalizedIndexCarrier = normalizeSelectedOperationInputCarrier(
    request.argument,
    dynamicIndexCarrier,
    rustSourcePrimitiveTargetType("int32"),
    context,
    options,
  );
  if (
    normalizedIndexCarrier === undefined ||
    !rustTargetTypeRefEquals(
      normalizedIndexCarrier,
      rustSourcePrimitiveTargetType("int32"),
    )
  ) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_DYNAMIC_INDEX_CARRIER_UNSUPPORTED",
      "Dynamic fixed-array element access requires an exact int32 index carrier; literal unions and other source carriers are not reconstructed from their spelling.",
    );
  }
  const template: RustProviderOperationTemplate = {
    kind: "provider-operation",
    operationId: "tsonic.rust.fixed-array.dynamic-index",
    operationKind: "indexer",
    target: {
      form: "index",
      indexConversion: rustInt32ToUsizeValueConversion,
    },
    resultCarrier: fixedArray.element,
    parameterCarriers: [rustSourcePrimitiveTargetType("int32")],
    isAsync: false,
    isFallible: false,
    errorBoundary: "none",
  };
  const fact = finalizeProviderOperationFromSubjects(
    template,
    request.receiver,
    [request.argument],
    context,
    options,
    receiverCarrier,
    [normalizedIndexCarrier],
  );
  if (fact === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_SELECTED_OPERATION_ABI_INCOMPLETE",
      "Dynamic fixed-array indexing cannot finalize one total Rust index ABI.",
    );
  }
  return acceptRustMemberOperation(
    request,
    "indexer",
    fact,
    context,
    options,
    elementProvenance(request),
  );
}

export function selectRustCheckedElementAccess(
  request: RustCheckedElementSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const selectedReceiverCarrier = selectedMemberReceiverCarrier(request, context, options);
  if (request.optionalChain === true && selectedReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_OPTIONAL_CHAIN_EVIDENCE_MISSING", "Optional-chain element access has no exact TSTS-selected non-null receiver type.");
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("indexer");
  }
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.sourceSelectedSymbol, precision: "exact" },
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked element access carries conflicting selected provider declaration identities.");
  }
  if (providerEvidence.kind === "selected") {
    if (tsonicFixedArrayProviderMember(providerEvidence.identity) === "index") {
      return selectRustFixedArrayElementAccess(
        request,
        selectedReceiverCarrier,
        context,
        options,
      );
    }
    return mapProviderCheckedOperation(request.expression, providerEvidence.identity, "indexer", context, options, request.receiver, [request.argument], request, selectedReceiverCarrier);
  }

  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    const declaration = request.sourceSelectedDeclaration;
    const index = rustProjectObjectIndexSignature(declaration, context.ast);
    const owner = index === undefined
      ? undefined
      : options.projectTypes.definitionContainingDeclaration(index.declaration);
    const relationship = owner === undefined || selectedReceiverCarrier === undefined
      ? undefined
      : options.projectTypes.relationship(selectedReceiverCarrier, owner);
    const declaredKeyCarrier = index === undefined
      ? undefined
      : resolveRustTargetTypeRef(Node_Type(context.ast, index.keyParameter), context, options);
    const declaredValueCarrier = index === undefined
      ? undefined
      : resolveRustTargetTypeRef(Node_Type(context.ast, index.declaration), context, options);
    const keyCarrier = declaredKeyCarrier === undefined || selectedReceiverCarrier === undefined
      ? undefined
      : options.projectTypes.instantiateMemberCarrier(
          index!.keyParameter,
          selectedReceiverCarrier,
          declaredKeyCarrier,
        );
    const resultCarrier = declaredValueCarrier === undefined || selectedReceiverCarrier === undefined
      ? undefined
      : options.projectTypes.instantiateMemberCarrier(
          index!.declaration,
          selectedReceiverCarrier,
          declaredValueCarrier,
        );
    const selectedKeyCarrier = normalizeSelectedLiteralCarrier(
      request.argument,
      selectedValueCarrier(
        request.argument,
        request.sourceArgumentType,
        context,
        options,
      ),
      keyCarrier,
      context,
      options,
    );
    const storageName = owner === undefined || index === undefined
      ? undefined
      : options.projectTypes.fieldStorageName(owner, index.declaration);
    if (index !== undefined) {
      if (owner?.kind !== "interface" || relationship?.kind !== "related" ||
        options.projectTypes.isPolymorphic(owner) || keyCarrier === undefined ||
        resultCarrier === undefined || selectedKeyCarrier === undefined ||
        storageName === undefined || !rustTargetTypeRefEquals(keyCarrier, selectedKeyCarrier)) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_PROJECT_INDEX_SIGNATURE_NOT_CLOSED",
          "Selected project index signature has no exact non-polymorphic Rust map storage, key carrier, and value carrier.",
        );
      }
      return acceptRustMemberOperation(request, "indexer", {
        kind: "source-index-signature",
        operationId: sourceOperationId(context, index.declaration, "index-signature"),
        receiverCarrier: selectedReceiverCarrier!,
        keyCarrier,
        storageName,
        writable: !context.ast.hasModifierKind(index.declaration, "readonly"),
        resultCarrier,
      }, context, options, elementProvenance(request));
    }
  }

  const receiverCarrier = selectedReceiverCarrier;
  if (receiverCarrier?.kind === "tuple") {
    const index = request.sourceSelectedElementIndex;
    const resultCarrier = index === undefined ? undefined : receiverCarrier.elements[index];
    if (index === undefined || resultCarrier === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_TUPLE_INDEX_NOT_PROVEN", "Tuple element access requires a TSTS-selected fixed ordinal within the tuple bounds.");
    }
    return acceptRustMemberOperation(request, "indexer", {
      kind: "tuple-index",
      operationId: `tsonic.rust.tuple.index.${index}`,
      index,
      resultCarrier,
    }, context, options, elementProvenance(request));
  }
  const fixedReceiver = rustFixedArrayCarrierValue(receiverCarrier);
  if (fixedReceiver !== undefined) {
    return selectRustFixedArrayElementAccess(
      request,
      receiverCarrier,
      context,
      options,
    );
  }

  const sourceProfileIdentity = resolveSelectedSourceProfileMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  const nativeArrayReceiver = receiverCarrier?.kind === "array"
    ? receiverCarrier
    : receiverCarrier?.kind === "reference" && receiverCarrier.referent.kind === "slice"
      ? receiverCarrier.referent
      : undefined;
  if (sourceProfileIdentity?.profile === "native" &&
    (sourceProfileIdentity.ownerName === "Array" || sourceProfileIdentity.ownerName === "ReadonlyArray") &&
    sourceProfileIdentity.memberName === "index" &&
    nativeArrayReceiver !== undefined && isRustCopyCarrier(nativeArrayReceiver.element)) {
    const template: RustProviderOperationTemplate = {
      kind: "provider-operation",
      operationId: `tsonic.rust.native.${sourceProfileIdentity.ownerName}.index`,
      operationKind: "indexer",
      target: { form: "index", indexConversion: rustInt32ToUsizeValueConversion },
      resultCarrier: nativeArrayReceiver.element,
      parameterCarriers: [rustSourcePrimitiveTargetType("int32")],
      isAsync: false,
      isFallible: false,
      errorBoundary: "none",
    };
    const fact = finalizeProviderOperationFromSubjects(template, request.receiver, [request.argument], context, options, selectedReceiverCarrier);
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", "Native array indexing cannot finalize one total Rust operation ABI.");
    }
    return acceptRustMemberOperation(request, "indexer", fact, context, options, elementProvenance(request));
  }

  const jsIdentity = resolveSelectedJsSourceMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (jsIdentity !== undefined) {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.expression, context, "RUST_JS_SURFACE_REQUIRED", "The selected index signature belongs to the explicit JavaScript source profile, which is not active.");
    }
    const selectedArgumentCarrier = selectedValueCarrier(
      request.argument,
      request.sourceArgumentType,
      context,
      options,
    );
    const selection = selectJsSurfaceOperation({
      ownerName: jsIdentity.ownerName,
      memberName: jsIdentity.memberName,
      operationKind: "indexer",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      argumentCarriers: [selectedArgumentCarrier],
      argumentCompatibility: selectedArgumentCompatibility([request.argument], context, options),
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SELECTED_OPERATION_UNSUPPORTED",
        `The selected JavaScript index signature '${jsIdentity.ownerName}' has no closed Rust operation row for this receiver carrier.`,
        [{
          message: `receiver=${JSON.stringify(receiverCarrier)}; argument=${JSON.stringify(selectedArgumentCarrier)}`,
        }],
      );
    }
    const fact = finalizeProviderOperationFromSubjects(
      selection.fact,
      request.receiver,
      [request.argument],
      context,
      options,
      selectedReceiverCarrier,
      [selectedArgumentCarrier],
    );
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `The selected JavaScript indexer '${jsIdentity.ownerName}.${jsIdentity.memberName}' cannot finalize one total Rust operation ABI.`);
    }
    return acceptRustMemberOperation(request, "indexer", fact, context, options, elementProvenance(request));
  }

  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("indexer");
  }
  return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_EVIDENCE_MISSING", "Checked element access has no selected provider, source-profile, tuple, or fixed-array evidence.");
}

export function selectRustCheckedIteration(
  request: RustCheckedIterationSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const source = request.source;
  if (source.iterationKind === "for-in") {
    const iterable = resolveRustTargetTypeRef(request.expression, context, options);
    const elementCarrier = resolveRustTargetTypeRef(source.sourceElementType, context, options);
    if (elementCarrier === undefined || !isRustStringCarrier(elementCarrier)) {
      return rejectSelectedOperation(
        request.statement,
        context,
        "RUST_ITERATION_KEY_CARRIER_UNSUPPORTED",
        "Rust property-key iteration requires the exact checked source key to map to String.",
      );
    }
    const lowering = rustPropertyKeyIterationLowering(iterable, context.ast, options);
    if (lowering === undefined) {
      return rejectSelectedOperation(
        request.statement,
        context,
        "RUST_ITERATION_CARRIER_UNSUPPORTED",
        "The selected Rust receiver carrier has no closed property-key iteration policy.",
      );
    }
    const fact: RustTargetOperationFact = {
      kind: "iteration",
      operationId: `tsonic.rust.iteration.for-in.${lowering.kind}`,
      iterationKind: "for-in",
      elementCarrier,
      lowering,
    };
    recordIterationInitializerCarrier(request.initializer, elementCarrier, context);
    return acceptRustOperation(request.statement, fact, context, {
      sourceExpression: request.expression,
      sourceResultType: source.sourceElementType,
    }, elementCarrier);
  }
  const iterable = resolveRustTargetTypeRef(request.expression, context, options);
  const targetIteration = rustIterableTargetPolicy(iterable);
  if (targetIteration === undefined) {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_CARRIER_UNSUPPORTED",
      `Selected ${source.iterationKind} iteration receiver is not a finalized supported Rust iterable carrier.`,
    );
  }
  const lowering = selectRustIterationLowering(
    source,
    targetIteration,
    isFreshRustIterationValue(request.expression, context.ast),
  );
  if (lowering === undefined) {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_MECHANISM_UNSUPPORTED",
      `Selected ${source.iterationKind} mechanism is incompatible with the finalized Rust iterable carrier.`,
    );
  }
  const fact: RustTargetOperationFact = {
    kind: "iteration",
    operationId: `tsonic.rust.iteration.${source.iterationKind}.${lowering.kind}${lowering.kind === "receiver-method" ? `.${lowering.name}` : ""}`,
    iterationKind: source.iterationKind,
    elementCarrier: targetIteration.elementCarrier,
    lowering,
  };
  recordIterationInitializerCarrier(request.initializer, targetIteration.elementCarrier, context);
  return acceptRustOperation(request.statement, fact, context, {
    sourceExpression: request.expression,
    sourceResultType: source.sourceElementType,
  }, targetIteration.elementCarrier);
}

type RustPropertyKeyIterationLowering = Extract<
  RustTargetOperationFact,
  { readonly kind: "iteration"; readonly iterationKind: "for-in" }
>["lowering"];

function rustPropertyKeyIterationLowering(
  iterable: TargetTypeRef | undefined,
  ast: import("@tsonic/tsts").AstReader,
  options: RustOperationsProviderOptions,
): RustPropertyKeyIterationLowering | undefined {
  if (iterable?.kind === "array" ||
    (iterable?.kind === "reference" && iterable.referent.kind === "slice") ||
    rustFixedArrayCarrierValue(iterable) !== undefined) {
    return { kind: "dense-index-keys" };
  }
  if (isRustJsArrayCarrier(iterable)) {
    return { kind: "js-array-index-keys" };
  }
  const keys = iterable === undefined
    ? undefined
    : options.sourceTypes.propertyKeysForCarrier(iterable, ast);
  return keys === undefined ? undefined : { kind: "static-keys", keys };
}

type RustIterableTargetPolicy =
  | {
      readonly kind: "borrowed";
      readonly elementCarrier: TargetTypeRef;
      readonly input: "direct" | "reference";
    }
  | {
      readonly kind: "js-array" | "sync-generator" | "async-generator";
      readonly elementCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "receiver-method";
      readonly elementCarrier: TargetTypeRef;
      readonly method: string;
    };

function rustIterableTargetPolicy(iterable: TargetTypeRef | undefined): RustIterableTargetPolicy | undefined {
  if (iterable?.kind === "array") {
    return { kind: "borrowed", elementCarrier: iterable.element, input: "reference" };
  }
  if (iterable?.kind === "reference" && iterable.referent.kind === "slice") {
    return { kind: "borrowed", elementCarrier: iterable.referent.element, input: "direct" };
  }
  const fixed = rustFixedArrayCarrierValue(iterable);
  if (fixed !== undefined) {
    return { kind: "borrowed", elementCarrier: fixed.element, input: "reference" };
  }
  const jsElement = isRustJsArrayCarrier(iterable) ? iterable?.typeArguments?.[0] : undefined;
  if (jsElement !== undefined) {
    return { kind: "js-array", elementCarrier: jsElement };
  }
  const mapTypes = getRustJsMapTargetTypes(iterable);
  if (mapTypes !== undefined && rustCarrierSupportsClone(mapTypes.key) &&
    rustCarrierSupportsClone(mapTypes.value)) {
    return {
      kind: "receiver-method",
      elementCarrier: { kind: "tuple", elements: [mapTypes.key, mapTypes.value] },
      method: "entries",
    };
  }
  const setElement = getRustJsSetElementTargetType(iterable);
  if (setElement !== undefined && rustCarrierSupportsClone(setElement)) {
    return { kind: "receiver-method", elementCarrier: setElement, method: "values" };
  }
  const generator = getRustGeneratorProtocol(iterable);
  return generator === undefined
    ? undefined
    : {
        kind: generator.kind === "sync" ? "sync-generator" : "async-generator",
        elementCarrier: generator.yieldType,
      };
}

function selectRustIterationLowering(
  source: Exclude<import("@tsonic/tsts").ResolvedSourceIterationInfo, { readonly iterationKind: "for-in" }>,
  target: RustIterableTargetPolicy,
  consumeResult: boolean,
): Extract<
  RustTargetOperationFact,
  { readonly kind: "iteration"; readonly iterationKind: "for-of" | "for-await-of" }
>["lowering"] | undefined {
  if (source.mechanism.kind === "union" || source.mechanism.kind === "untyped-dynamic-iteration") {
    return undefined;
  }
  if (source.iterationKind === "for-of") {
    if (target.kind === "async-generator") {
      return undefined;
    }
    if (target.kind === "borrowed") {
      if (consumeResult) {
        return { kind: "owned" };
      }
      return {
        kind: "borrowed",
        style: isRustCopyCarrier(target.elementCarrier) ? "copied" : "cloned",
        input: target.input,
      };
    }
    if (target.kind === "receiver-method") {
      return { kind: "receiver-method", name: target.method };
    }
    return target.kind === "js-array" ? { kind: "js-array" } : { kind: "owned" };
  }
  if (source.mechanism.kind === "asynchronous-iterator-protocol") {
    return target.kind === "async-generator" ? { kind: "async-generator" } : undefined;
  }
  if (target.kind === "async-generator") {
    return undefined;
  }
  if (target.kind === "borrowed") {
    if (consumeResult) {
      return { kind: "owned" };
    }
    return {
      kind: "borrowed",
      style: isRustCopyCarrier(target.elementCarrier) ? "copied" : "cloned",
      input: target.input,
    };
  }
  if (target.kind === "receiver-method") {
    return { kind: "receiver-method", name: target.method };
  }
  return target.kind === "js-array" ? { kind: "js-array" } : { kind: "owned" };
}

function isFreshRustIterationValue(
  expression: Node,
  ast: import("@tsonic/tsts").AstReader,
): boolean {
  const kind = ast.kindName(expression);
  if (kind === KindCallExpression || kind === KindNewExpression || kind === KindArrayLiteralExpression) {
    return true;
  }
  if (kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
    kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
    kind !== "KindTypeAssertionExpression" && kind !== "KindAwaitExpression") {
    return false;
  }
  const inner = Node_Expression(ast, expression);
  return inner !== undefined && isFreshRustIterationValue(inner, ast);
}

function recordIterationInitializerCarrier(
  initializer: ExtensionFactSubject | undefined,
  carrier: TargetTypeRef,
  context: RustOperationPolicyContext,
): void {
  const root = asNode(initializer, context);
  if (root === undefined) {
    return;
  }
  const evidence = [{ message: "rust selected iteration binding carrier" }];
  context.facts.set(root, rustRuntimeCarrierKey, { carrier }, evidence);
  const declarations = VariableDeclarationList_Declarations(context.ast, root);
  if (declarations === undefined || !isDenseDataArray(declarations)) {
    return;
  }
  for (const declaration of declarations) {
    if (declaration !== undefined && context.ast.kindName(declaration) === "KindVariableDeclaration") {
      context.facts.set(declaration, rustRuntimeCarrierKey, { carrier }, evidence);
    }
  }
}

export function selectRustCheckedConversion(
  request: RustCheckedConversionSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedConversionSelectionResult> {
  if (request.conversionKind === "call-argument") {
    const targetCarrier = request.targetParameter.type;
    const selectedTypeParameterNames = new Set(
      request.selectedSignature.sourceSelectedMethodTypeArguments?.map((argument) => argument.typeParameterName) ?? [],
    );
    if (selectedTypeParameterNames.size > 0 &&
      rustTargetTypeContainsTypeParameter(targetCarrier, selectedTypeParameterNames)) {
      return acceptRustPolicy({}, [
        { message: "rust deferred the selected generic source-call argument carrier to post-check target substitution" },
      ]);
    }
    const sourceCarrier = rustEffectiveValueCarrier(context.facts, request.expression) ??
      resolveRustTargetTypeRef(request.expression, context, options);
    if (sourceCarrier !== undefined && rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument already has the selected target parameter carrier" },
      ]);
    }
    const sourceNode = asNode(request.expression, context);
    const sourceKind = sourceNode === undefined ? "" : context.ast.kindName(sourceNode);
    if ((targetCarrier.kind === "function-pointer" || targetCarrier.kind === "closure" ||
      rustCallableProtocol(targetCarrier) !== undefined) &&
      (sourceKind === "KindArrowFunction" || sourceKind === "KindFunctionExpression")) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected function expression uses the selected target callable carrier" },
      ]);
    }
    if (targetCarrier.kind === "source-primitive" && sourceNode !== undefined &&
      sourceLiteralIsRepresentableAsPrimitive(sourceNode, targetCarrier.name, context)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected literal is representable by the selected target primitive carrier" },
      ]);
    }
    if (targetCarrier.kind === "reference" && sourceCarrier !== undefined &&
      rustTargetTypeRefEquals(targetCarrier.referent, sourceCarrier)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument borrows into the selected target reference carrier" },
      ]);
    }
    const reconciliation = sourceCarrier === undefined
      ? undefined
      : selectRustValueCarrierReconciliation(sourceCarrier, targetCarrier, options.projectTypes);
    if (reconciliation?.kind === "project-upcast") {
      recordRustValueCarrierReconciliation(context.facts, request.expression, reconciliation);
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument uses an exact project-type upcast" },
      ]);
    }
    const optionElement = rustOptionElementCarrier(targetCarrier);
    if (optionElement !== undefined) {
      if (isRustNullishSourceCarrier(sourceCarrier)) {
        return acceptRustPolicy({ convertedType: targetCarrier }, [
          { message: "rust selected nullish argument maps to the selected Option carrier" },
        ]);
      }
      if (rustTargetTypeRefEquals(sourceCarrier, optionElement) ||
        (sourceNode !== undefined && optionElement.kind === "source-primitive" &&
          sourceLiteralIsRepresentableAsPrimitive(sourceNode, optionElement.name, context))) {
        return acceptRustPolicy({ convertedType: targetCarrier }, [
          { message: "rust selected value argument maps to the selected Option element carrier" },
        ]);
      }
    }
    if (sourceCarrier === undefined) {
      return acceptRustPolicy({}, [
        { message: "rust deferred unavailable source carrier to independent post-check operation-input validation" },
      ]);
    }
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_CALL_ARGUMENT_CONVERSION_UNSUPPORTED",
      "The TSTS-selected call argument cannot be represented by the selected Rust target parameter carrier.",
    );
  }
  const targetCarrier = resolveRustTargetTypeRef(request.explicitTargetTypeNode, context, options);
  const sourceCarrier = rustEffectiveValueCarrier(context.facts, request.sourceExpression) ??
    resolveRustTargetTypeRef(request.sourceExpression, context, options);
  if (targetCarrier === undefined || sourceCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_ASSERTION_CARRIER_MISSING",
      "Checked source assertion has no closed source and target Rust carriers from TSTS evidence.",
    );
  }
  const identity = rustTargetTypeRefEquals(sourceCarrier, targetCarrier);
  const reconciliation = identity
    ? { kind: "identity" as const }
    : selectRustValueCarrierReconciliation(sourceCarrier, targetCarrier, options.projectTypes);
  const projectUpcast = reconciliation.kind === "project-upcast";
  if (projectUpcast) {
    recordRustValueCarrierReconciliation(context.facts, request.expression, reconciliation);
  }
  const projectDowncast = !identity && !projectUpcast && selectProjectDowncast(
    request.expression,
    sourceCarrier,
    targetCarrier,
    context,
    options,
  );
  const conversion = identity || projectUpcast || projectDowncast
    ? undefined
    : selectRustSourceValueConversion(sourceCarrier, targetCarrier);
  if (!identity && !projectUpcast && !projectDowncast && conversion === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_ASSERTION_UNSUPPORTED",
      "Checked source assertion does not map to an identity or explicit Rust runtime conversion.",
    );
  }
  const operationId = identity
    ? "tsonic.rust.conversion.identity"
    : projectUpcast
      ? "tsonic.rust.conversion.project-upcast"
      : projectDowncast
        ? "tsonic.rust.conversion.project-downcast"
    : `tsonic.rust.conversion.${rustValueConversionIdentity(conversion!)}`;
  const fact: RustTargetOperationFact = {
    kind: "source-conversion",
    operationId,
    ...(conversion === undefined ? {} : { conversion }),
    resultCarrier: targetCarrier,
  };
  const operation: RustTargetOperationSelection = {
    operationId,
    operationKind: "operator",
    targetOperation: identity
      ? "identity"
      : projectUpcast
        ? "project-upcast"
        : projectDowncast
          ? "project-downcast"
          : "runtime-conversion",
    resultType: targetCarrier,
    provenance: {
      sourceExpression: request.sourceExpression,
      sourceSelectedSymbol: request.sourceSelectedSymbol,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceResultType: request.target,
    },
  };
  const evidence = [{ message: identity
    ? "rust selected assertion identity conversion"
    : projectUpcast
      ? "rust selected assertion project-type upcast"
      : projectDowncast
        ? "rust selected assertion project-type downcast"
      : `rust selected assertion conversion '${rustValueConversionIdentity(conversion!)}'` }];
  context.facts.set(request.expression, rustTargetOperationFactKey, fact, evidence);
  context.facts.set(request.expression, rustSelectedOperationKey, operation, evidence);
  return acceptRustPolicy({ convertedType: targetCarrier, operation }, evidence);
}

function selectProjectDowncast(
  subject: Node,
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): boolean {
  const dispatchCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
  const sourceDefinition = options.projectTypes.definitionForCarrier(dispatchCarrier);
  const targetDefinition = options.projectTypes.definitionForCarrier(targetCarrier);
  const relationship = sourceDefinition === undefined || targetDefinition === undefined ||
      targetDefinition.kind !== "class" || targetDefinition.typeParameterNames.length !== 0
    ? { kind: "unrelated" as const }
    : options.projectTypes.relationship(targetCarrier, sourceDefinition);
  if (sourceDefinition === undefined || relationship.kind !== "related" ||
    !rustTargetTypeRefEquals(relationship.targetType, dispatchCarrier) ||
    options.projectTypes.downcastRoute(sourceDefinition, targetCarrier) === undefined) {
    return false;
  }
  context.facts.set(subject, rustProjectDowncastFactKey, {
    sourceCarrier,
    dispatchCarrier,
    targetCarrier,
  }, [{ message: "rust exact project-type downcast" }]);
  return true;
}

function mapProviderCheckedOperation(
  expression: ExtensionFactSubject,
  identity: ProviderDeclarationIdentity,
  operationKind: RustProviderFactOperationKind,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  sourceReceiver: ExtensionFactSubject | undefined,
  sourceArguments: readonly ExtensionFactSubject[],
  memberRequest?: RustCheckedPropertySelectionInput,
  selectedReceiverCarrier?: TargetTypeRef,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const selection = selectRustProviderOperation(options.providerRows, identity, operationKind);
  if (selection.kind === "missing") {
    return rejectSelectedOperation(expression, context, "RUST_PROVIDER_OPERATION_NOT_MAPPED", `No Rust operation row matches selected provider declaration '${providerIdentityText(identity)}' as ${operationKind}.`);
  }
  if (selection.kind === "ambiguous") {
    return rejectSelectedOperation(expression, context, "RUST_PROVIDER_OPERATION_AMBIGUOUS", `Selected provider declaration '${providerIdentityText(identity)}' matches ${selection.rows.length} Rust operation rows.`);
  }
  const template = providerOperationFact(selection.row);
  const fact = finalizeProviderOperationFromSubjects(
    template,
    sourceReceiver,
    sourceArguments,
    context,
    options,
    selectedReceiverCarrier,
  );
  if (fact === undefined) {
    return rejectSelectedOperation(expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `Selected provider declaration '${providerIdentityText(identity)}' cannot finalize one total Rust operation ABI.`);
  }
  const provenance = memberRequest === undefined
    ? {
        sourceExpression: expression,
        providerDeclaration: identity,
      }
    : {
        sourceExpression: expression,
        sourceReceiver: memberRequest.receiver,
        sourceSelectedSymbol: memberRequest.sourceSelectedSymbol,
        sourceSelectedDeclaration: memberRequest.sourceSelectedDeclaration,
        sourceSelectedReadDeclaration: memberRequest.sourceSelectedReadDeclaration,
        sourceSelectedWriteDeclaration: memberRequest.sourceSelectedWriteDeclaration,
        sourceResultType: memberRequest.sourceResultType,
        providerDeclaration: identity,
      };
  return memberRequest === undefined
    ? acceptRustOperation(expression, fact, context, provenance)
    : acceptRustMemberOperation(
        memberRequest,
        operationKind === "indexer" ? "indexer" : "property",
        fact,
        context,
        options,
        provenance,
      );
}

function finalizeProviderOperationFromSubjects(
  template: RustProviderOperationTemplate,
  sourceReceiver: ExtensionFactSubject | undefined,
  sourceArguments: readonly ExtensionFactSubject[],
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  selectedReceiverCarrier?: TargetTypeRef,
  selectedArgumentCarriers?: readonly (TargetTypeRef | undefined)[],
): Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> | undefined {
  const rawArgumentCarriers = sourceArguments.map((argument, index) =>
    selectedArgumentCarriers?.[index] ??
      rustEffectiveValueCarrier(context.facts, argument) ??
      resolveRustTargetTypeRef(argument, context, options));
  const rawReceiverCarrier = selectedReceiverCarrier ?? (sourceReceiver === undefined
    ? undefined
    : resolveRustTargetTypeRef(sourceReceiver, context, options));
  const instantiation = instantiateProviderOperationTemplate(template, {
    sourceReceiverCarrier: rawReceiverCarrier,
    sourceParameterCarriers: rawArgumentCarriers,
  });
  if (instantiation === undefined) {
    return undefined;
  }
  const instantiatedTemplate = instantiation.template;
  const sourceArgumentCarriers = sourceArguments.map((argument, index) => {
    const resolved = selectedArgumentCarriers?.[index] ??
      rustEffectiveValueCarrier(context.facts, argument) ??
      resolveRustTargetTypeRef(argument, context, options);
    return normalizeSelectedOperationInputCarrier(
      argument,
      resolved,
      instantiatedTemplate.parameterCarriers?.[index],
      context,
      options,
    );
  });
  if (sourceArgumentCarriers.some((carrier) => carrier === undefined)) {
    return undefined;
  }
  const sourceReceiverCarrier = rawReceiverCarrier;
  if (providerFormRequiresSourceReceiver(instantiatedTemplate.target) && sourceReceiverCarrier === undefined) {
    return undefined;
  }
  return finalizeProviderOperationFact(instantiatedTemplate, sourceArgumentCarriers as TargetTypeRef[], sourceReceiverCarrier);
}

function acceptRustOperation(
  subject: ExtensionFactSubject,
  fact: RustTargetOperationFact,
  context: RustOperationPolicyContext,
  provenance: NonNullable<RustTargetOperationSelection["provenance"]>,
  resultType: TargetTypeRef | undefined = rustTargetOperationResultCarrier(fact),
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const evidence = [{ message: `rust selected operation ${fact.operationId}` }];
  context.facts.set(subject, rustTargetOperationFactKey, fact, evidence);
  const operation: RustTargetOperationSelection = {
    operationId: fact.operationId,
    operationKind: genericOperationKind(fact),
    targetOperation: rustTargetOperationText(fact),
    ...(resultType === undefined ? {} : { resultType }),
    provenance,
  };
  context.facts.set(subject, rustSelectedOperationKey, operation, evidence);
  return acceptRustPolicy({
    operation,
    ...(resultType === undefined ? {} : { resultType }),
    provenance,
  }, evidence);
}

function selectedMemberReceiverCarrier(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const receiver = asNode(request.receiver, context);
  const sourceCarrier = resolveRustTargetTypeRef(
    request.receiver,
    context,
    options,
  );
  if (receiver === undefined || sourceCarrier === undefined) {
    return undefined;
  }
  const optionElement = rustOptionElementCarrier(sourceCarrier);
  if (request.optionalChain === true && optionElement !== undefined) {
    return optionElement;
  }
  if (request.sourceReceiverType === undefined) {
    return undefined;
  }
  const selectedCarrier = resolveRustTargetTypeRef(
    request.sourceReceiverType,
    context,
    options,
  );
  if (selectedCarrier === undefined) {
    return undefined;
  }
  if (rustTargetTypeRefEquals(sourceCarrier, selectedCarrier)) {
    return sourceCarrier;
  }
  if (isRustProgramErrorCarrier(sourceCarrier)) {
    const selectedDefinition = options.projectTypes.definitionForCarrier(selectedCarrier);
    return selectedDefinition !== undefined &&
        options.projectTypes.programErrorVariant(selectedDefinition) !== undefined
      ? selectedCarrier
      : undefined;
  }
  const selectedOperation = context.facts.resolve(receiver, rustTargetOperationFactKey);
  const preparedOperation = context.facts.resolve(receiver, rustPreparedOperationResultFactKey);
  const selectedOperationResult = selectedOperation === undefined
    ? preparedOperation?.resultCarrier
    : rustTargetOperationResultCarrier(selectedOperation);
  if (request.optionalChain !== true && selectedOperationResult !== undefined &&
    rustTargetTypeRefEquals(sourceCarrier, selectedOperationResult)) {
    return sourceCarrier;
  }
  const declaredCarrier = optionElement ?? sourceCarrier;
  const declaredDefinition = options.projectTypes.definitionForCarrier(declaredCarrier);
  const selectedDefinition = options.projectTypes.definitionForCarrier(selectedCarrier);
  const selectedRelationship = declaredDefinition === undefined || selectedDefinition === undefined
    ? { kind: "unrelated" as const }
    : options.projectTypes.relationship(selectedCarrier, declaredDefinition);
  if (selectedRelationship.kind === "related" &&
    rustTargetTypeRefEquals(selectedRelationship.targetType, declaredCarrier)) {
    return selectedCarrier;
  }
  if (optionElement !== undefined) {
    return rustTargetTypeRefEquals(optionElement, selectedCarrier)
      ? optionElement
      : undefined;
  }
  const refinement = context.source.semantics.selectValueTypeRefinement(receiver);
  if (refinement.kind === "resolved" && refinement.refinement.kind === "exact") {
    return sourceCarrier;
  }
  if (refinement.kind === "resolved" && refinement.refinement.kind === "members" &&
    options.sourceTypes.sourceUnionForCarrier(sourceCarrier) !== undefined) {
    return sourceCarrier;
  }
  return undefined;
}

function acceptRustMemberOperation(
  request: RustCheckedPropertySelectionInput,
  operationKind: "property" | "indexer",
  fact: RustTargetOperationFact,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  provenance: NonNullable<RustTargetOperationSelection["provenance"]>,
  innerResultCarrier: TargetTypeRef | undefined = rustTargetOperationResultCarrier(fact),
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const sourceReceiverCarrier = resolveRustTargetTypeRef(
    request.receiver,
    context,
    options,
  );
  const operationReceiverCarrier = request.optionalChain === true
    ? rustOptionElementCarrier(sourceReceiverCarrier) ?? sourceReceiverCarrier
    : sourceReceiverCarrier;
  const selectedReceiverCarrier = fact.kind === "provider-operation" &&
      fact.abi.sourceReceiver.kind === "receiver"
    ? fact.abi.sourceReceiver.carrier
    : selectedMemberReceiverCarrier(request, context, options);
  if (operationReceiverCarrier !== undefined && selectedReceiverCarrier !== undefined) {
    const projection = selectRustFlowReadProjection(
      operationReceiverCarrier,
      selectedReceiverCarrier,
      options.projectTypes,
    );
    if (projection.kind === "incompatible") {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_SELECTED_RECEIVER_PROJECTION_UNSUPPORTED",
        "The checked member receiver cannot project from its exact runtime carrier to its TSTS-selected carrier.",
      );
    }
    if (projection.kind === "projection") {
      recordRustFlowReadProjection(context.facts, request.receiver, projection.fact);
    }
  }
  if (request.optionalChain !== true) {
    return acceptRustOperation(request.expression, fact, context, provenance, innerResultCarrier);
  }
  const selection = selectRustOptionalChain({
    expression: request.expression,
    guard: request.receiver,
    operationKind,
    sourceGuardCarrier: resolveRustTargetTypeRef(
      request.sourceReceiverDeclaration ?? request.receiver,
      context,
      options,
    ),
    selectedGuardCarrier: selectedMemberReceiverCarrier(request, context, options),
    innerResultCarrier,
  });
  if (selection.kind === "rejected") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_OPTIONAL_CHAIN_CONTRACT_INVALID",
      selection.message,
    );
  }
  if (selection.kind === "direct") {
    return acceptRustOperation(
      request.expression,
      fact,
      context,
      provenance,
      selection.resultCarrier,
    );
  }
  const accepted = acceptRustOperation(
    request.expression,
    fact,
    context,
    provenance,
    selection.fact.resultCarrier,
  );
  context.facts.set(
    request.expression,
    rustOptionalChainFactKey,
    selection.fact,
    [{ message: `rust optional chain ${selection.fact.lowering}` }],
  );
  return accepted;
}

function acceptDeclarationOperation(
  operationKind: RustTargetOperationSelection["operationKind"],
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  return acceptRustPolicy({
    operation: genericOperation(`tsonic.rust.declaration.${operationKind}`, operationKind, "declaration-only"),
  }, [{ message: "rust declaration-only checked operation" }]);
}

function rejectSelectedOperation<T>(
  nodeOrSpan: ExtensionFactSubject,
  context: RustOperationPolicyContext,
  extensionCode: string,
  message: string,
  evidence: readonly { readonly message: string }[] = [],
): RustPolicySelection<T> {
  return rejectRustPolicy({
    extensionId: context.extensionId,
    extensionCode,
    numericCode: 0,
    category: "error",
    message,
    nodeOrSpan,
    evidence: [{ message: "target.capability=rust.selected-operation" }, ...evidence],
  });
}

function providerOperationFact(
  row: RustProviderOperationRow<RustProviderFactOperationKind>,
): RustProviderOperationTemplate {
  return providerOperationTemplate(row, row.operationKind);
}

function providerOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind,
>(
  row: RustProviderOperationRow<OperationKind>,
  operationKind: OperationKind,
): RustProviderOperationTemplate<OperationKind> {
  return {
    kind: "provider-operation",
    operationId: providerOperationId(row),
    operationKind,
    target: row.target,
    resultCarrier: row.resultCarrier,
    ...(row.parameterCarriers === undefined ? {} : { parameterCarriers: row.parameterCarriers }),
    ...(row.receiverCarrier === undefined ? {} : { receiverCarrier: row.receiverCarrier }),
    ...(row.typeParameters === undefined ? {} : { typeParameters: row.typeParameters }),
    ...(row.typeRequirements === undefined ? {} : { typeRequirements: row.typeRequirements }),
    ...(row.targetTypeArguments === undefined ? {} : { targetTypeArguments: row.targetTypeArguments }),
    ...(row.resultConversion === undefined ? {} : { resultConversion: row.resultConversion }),
    isAsync: row.isAsync === true,
    isFallible: row.isFallible === true,
    errorBoundary: row.isFallible === true ? row.errorBoundary : "none",
    isUnsafe: row.isUnsafe === true,
  };
}

function providerOperationId(row: RustProviderOperationRow): string {
  const identity = row.signatureId ?? row.memberId ?? row.exportId;
  const segment = (value: string): string => `${value.length}:${value}`;
  return `tsonic.rust.provider.${[
    row.providerPackageId,
    row.providerId,
    row.providerVersion,
    row.providerModuleId,
    row.moduleSpecifier,
    identity,
  ].map(segment).join("")}`;
}

function elementProvenance(request: RustCheckedElementSelectionInput): NonNullable<RustTargetOperationSelection["provenance"]> {
  return {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceResultType: request.sourceResultType,
  };
}

function sourceOperationId(
  context: RustOperationPolicyContext,
  declaration: Node,
  kind: string,
): string {
  const ast = context.ast;
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return `tsonic.rust.source.${kind}:${fileName}:${ast.pos(declaration)}:${ast.end(declaration)}`;
}

function isDeclarationFileSubject(subject: ExtensionFactSubject, context: RustOperationPolicyContext): boolean {
  const node = asNode(subject, context);
  return node !== undefined && context.ast.isDeclarationFile(context.ast.getSourceFile(node));
}

function selectedDeclarationIsCallable(
  subject: ExtensionFactSubject | undefined,
  context: RustOperationPolicyContext,
): boolean {
  const declaration = asNode(subject, context);
  if (declaration === undefined) {
    return false;
  }
  const kind = context.ast.kindName(declaration);
  return kind === "KindMethodDeclaration" ||
    kind === "KindMethodSignature" ||
    kind === "KindCallSignature" ||
    kind === "KindConstructSignature" ||
    kind === "KindFunctionDeclaration" ||
    kind === "KindFunctionType";
}

function genericOperation(
  operationId: string,
  operationKind: RustTargetOperationSelection["operationKind"],
  targetOperation: string,
): RustTargetOperationSelection {
  return { operationId, operationKind, targetOperation };
}

function genericOperationKind(fact: RustTargetOperationFact): RustTargetOperationSelection["operationKind"] {
  switch (fact.kind) {
    case "provider-operation":
      return fact.abi.operationKind;
    case "tuple-index":
    case "fixed-index":
    case "source-index-signature":
      return "indexer";
    case "source-field":
    case "source-method-property":
    case "source-static-field":
    case "source-accessor":
    case "source-union-field":
    case "source-enum-member":
      return "property";
    case "iteration":
      return "iteration";
    default:
      return "operator";
  }
}

function providerIdentityText(identity: ProviderDeclarationIdentity): string {
  return [identity.providerId, identity.providerModuleId, identity.moduleSpecifier, identity.exportName, identity.memberName, identity.signatureId]
    .filter((part) => part !== undefined)
    .join("::");
}

function sourceLiteralIsRepresentableAsPrimitive(
  node: Node,
  primitive: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>["name"],
  context: RustOperationPolicyContext,
): boolean {
  return selectedSourceLiteralIsRepresentable(node, primitive, context.ast);
}

function normalizeSelectedLiteralCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const node = asNode(subject, context);
  if (node === undefined || expected === undefined) {
    return actual;
  }
  if (context.ast.kindName(node) === "KindStringLiteral") {
    const variant = options.sourceTypes.enumVariantForLiteral(expected, context.ast.text(node));
    if (variant !== undefined) {
      const fact: RustTargetOperationFact = {
        kind: "source-enum-member",
        operationId: `tsonic.rust.union.variant:${variant.name}`,
        name: variant.name,
        resultCarrier: expected,
      };
      context.facts.set(node, rustTargetOperationFactKey, fact, [
        { message: "rust selected source enum literal" },
      ]);
      context.facts.set(node, rustRuntimeCarrierKey, { carrier: expected }, [
        { message: "rust selected source enum literal carrier" },
      ]);
      return expected;
    }
  }
  if (expected.kind !== "source-primitive" || !isRustNumericCarrier(expected)) {
    return actual;
  }
  if (!sourceLiteralIsRepresentableAsPrimitive(node, expected.name, context)) {
    return actual;
  }
  context.facts.set(node, rustRuntimeCarrierKey, { carrier: expected }, [
    { message: "rust selected numeric literal carrier from checked peer/target evidence" },
  ]);
  const numericOperationId = selectedSourceNumericLiteralOperationId(node, context.ast);
  if (numericOperationId === rustPostCheckUnaryMinusOperationId) {
    const fact: RustTargetOperationFact = {
      kind: "operator-token",
      operationId: rustPostCheckUnaryMinusOperationId,
      operator: "-",
      resultCarrier: expected,
    };
    context.facts.set(node, rustTargetOperationFactKey, fact, [
      { message: "rust finalized selected unary-minus literal carrier" },
    ]);
    context.facts.set(node, rustSelectedOperationKey, {
      operationId: fact.operationId,
      operationKind: "operator",
      targetOperation: rustTargetOperationText(fact),
      resultType: expected,
      provenance: { sourceExpression: node },
    });
  } else if (numericOperationId === rustPostCheckUnaryPlusOperationId) {
    const fact: RustTargetOperationFact = {
      kind: "source-conversion",
      operationId: rustPostCheckUnaryPlusOperationId,
      resultCarrier: expected,
    };
    context.facts.set(node, rustTargetOperationFactKey, fact, [
      { message: "rust finalized selected unary-plus literal carrier" },
    ]);
    context.facts.set(node, rustSelectedOperationKey, {
      operationId: fact.operationId,
      operationKind: "operator",
      targetOperation: rustTargetOperationText(fact),
      resultType: expected,
      provenance: { sourceExpression: node },
    });
  }
  return expected;
}

function normalizeSelectedOperationInputCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const direct = normalizeSelectedLiteralCarrier(
    subject,
    actual,
    expected,
    context,
    options,
  );
  const optionElement = rustOptionElementCarrier(expected);
  if (optionElement === undefined || direct === undefined ||
    rustTargetTypeRefEquals(direct, expected)) {
    return direct;
  }
  if (isRustDefinitelyNullishCarrier(direct)) {
    return expected;
  }
  const inner = normalizeSelectedLiteralCarrier(
    subject,
    direct,
    optionElement,
    context,
    options,
  );
  return rustTargetTypeRefEquals(inner, optionElement) ? expected : direct;
}

function normalizeSelectedArgumentCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const literal = normalizeSelectedLiteralCarrier(subject, actual, expected, context, options);
  if (literal !== actual || (expected?.kind !== "function-pointer" && expected?.kind !== "closure" &&
    rustCallableProtocol(expected) === undefined)) {
    return literal;
  }
  const node = asNode(subject, context);
  const kind = node === undefined ? "" : context.ast.kindName(node);
  return kind === "KindArrowFunction" || kind === "KindFunctionExpression"
    ? expected
    : actual;
}

function selectedArgumentCompatibility(
  subjects: readonly ExtensionFactSubject[],
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): NonNullable<Parameters<typeof selectJsSurfaceOperation>[0]["argumentCompatibility"]> {
  return (expected, actual, index) => {
    const subject = subjects[index];
    const node = asNode(subject, context);
    if (node === undefined) {
      return undefined;
    }
    if (context.ast.kindName(node) === "KindStringLiteral" &&
      options.sourceTypes.enumVariantForLiteral(expected, context.ast.text(node)) !== undefined) {
      return 1;
    }
    const kind = context.ast.kindName(node);
    const callable = rustCallableProtocol(expected);
    if ((expected.kind === "function-pointer" || expected.kind === "closure" || callable !== undefined) &&
      (kind === "KindArrowFunction" || kind === "KindFunctionExpression")) {
      const parameterCount = expected.kind === "function-pointer" || expected.kind === "closure"
        ? expected.args.length
        : callable!.parameters.length;
      return context.ast.parameters(node).length === parameterCount ? 1 : undefined;
    }
    if (actual === undefined) {
      return 10;
    }
    const reconciliation = selectRustValueCarrierReconciliation(
      actual,
      expected,
      options.projectTypes,
    );
    if (reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
      return 1;
    }
    return expected.kind === "source-primitive" && isRustNumericCarrier(expected) &&
      sourceLiteralIsRepresentableAsPrimitive(node, expected.name, context)
      ? 1
      : undefined;
  };
}

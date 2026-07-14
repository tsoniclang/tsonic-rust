import {
  TstsProviderContractVersion,
  acceptObservation,
  contextualTargetTypeFactKey,
  deferObservation,
  flowStateFactKey,
  rejectObservation,
  runtimeCarrierFactKey,
  selectedTargetSignatureFactKey,
  targetOperationFactKey,
} from "@tsonic/tsts";
import type {
  CheckedCallMappingRequest,
  CheckedCallMappingResult,
  CheckedConversionMappingRequest,
  CheckedConversionMappingResult,
  CheckedElementAccessMappingRequest,
  CheckedIterationMappingRequest,
  CheckedOperationMappingResult,
  CheckedOperatorMappingRequest,
  CheckedPropertyAccessMappingRequest,
  ContextualTargetTypeRequest,
  ContextualTargetTypeResult,
  ExtensionFactSubject,
  ExtensionObservation,
  ExtensionObservationContext,
  Node,
  ParameterPassingRequest,
  ParameterPassingResult,
  ProviderDeclarationIdentity,
  ProviderIdentity,
  RuntimeCarrierFactRequest,
  RuntimeCarrierFactResult,
  TargetMember,
  TargetOperationFact,
  TargetSemanticProvider,
  TargetTypeRef,
} from "@tsonic/tsts";
import {
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
  Node_Type,
} from "../../common/source-ast.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import type {
  RustProviderOperationRow,
} from "../provider-packages/index.js";
import {
  rustFixedArrayCarrierValue,
  rustJsValueTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustTargetTypeRefEquals,
  rustUnitTargetType,
  rustVecTargetType,
} from "../rust-target-types.js";
import {
  isRustBoolCarrier,
  isRustIntegerCarrier,
  isRustJsArrayCarrier,
  isRustNullishSourceCarrier,
  isRustNumericCarrier,
  isRustOptionCarrier,
  rustOptionElementCarrier,
  isRustSignedNumericCarrier,
} from "../rust-target-types.js";
import {
  selectRustBinaryOperator,
  selectRustCompoundAssignment,
} from "./operator-rules.js";
import {
  rustSourceTypeCarrier,
  rustTargetOperationResultCarrier,
  rustTargetOperationFactKey,
  rustPostCheckBinaryOperationId,
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
  rustSourceParameterAbiFactKey,
} from "../rust-facts/keys.js";
import type {
  RustOperatorToken,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustTargetOperationFact,
} from "../rust-facts/keys.js";
import {
  rustInt32ToUsizeValueConversion,
  selectRustSourceValueConversion,
} from "../rust-facts/value-conversions.js";
import {
  rustArgumentPassingMode,
} from "../rust-facts/parameter-passing.js";
import {
  finalizeRustProviderOperationAbi,
} from "../rust-facts/finalized-operation-abi.js";
import {
  selectJsSurfaceConstructorBySourceOwner,
  selectJsSurfaceOperation,
} from "./js-surface-operations.js";
import type { JsOperationSelection } from "./js-surface-operations.js";
import {
  asNode,
  isProjectSourceDeclaration,
  resolveSelectedJsSourceMember,
  resolveSelectedProviderDeclaration,
  resolveSelectedSourceProfileMember,
} from "./selected-evidence.js";
import {
  selectRustProviderOperation,
} from "./provider-operation-selection.js";
import {
  resolveRustTargetTypeRef,
} from "./target-type-resolution.js";
import {
  tsonicCoreSourceSemanticsModules,
} from "@tsonic/source-core";
import type { RustSourceTypeRegistry } from "./source-type-registry.js";
import type { RustSourceProfileRegistry } from "./source-profile-registry.js";
import { selectedSourceLiteralIsRepresentable } from "./selected-numeric-literal.js";
import type { RustSourceCallableAbiResolver } from "./source-callable-abi.js";

const sourceCallMarkerByIdentity = new Map(
  tsonicCoreSourceSemanticsModules().flatMap((module) =>
    module.exports
      .filter((declaration) => declaration.kind === "call-marker")
      .map((declaration) => [
        `${module.moduleSpecifier}::${declaration.exportName}`,
        declaration.marker,
      ] as const)),
);

export interface RustOperationsProviderOptions {
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerCarrierPaths: ReadonlyMap<string, string>;
  readonly jsEnabled: boolean;
  readonly regExpSubsetViolation: (pattern: string, flags: string) => string | undefined;
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
}

export function createRustOperationsProvider(options: RustOperationsProviderOptions): TargetSemanticProvider {
  const identity: ProviderIdentity = {
    id: "tsonic.rust.operations",
    version: "0.0.1",
    target: "rust",
    extensionContractVersion: TstsProviderContractVersion,
    providerKind: "semantic",
    displayName: "Tsonic Rust semantic mapper",
  };
  return {
    identity,
    mapCheckedCall(request, context) {
      return mapRustCheckedCall(request, context, options);
    },
    mapCheckedPropertyAccess(request, context) {
      return mapRustCheckedPropertyAccess(request, context, options);
    },
    mapCheckedElementAccess(request, context) {
      return mapRustCheckedElementAccess(request, context, options);
    },
    mapCheckedOperator(request, context) {
      return mapRustCheckedOperator(request, context, options);
    },
    mapCheckedIteration(request, context) {
      return mapRustCheckedIteration(request, context, options);
    },
    recordContextualTargetType(request, context) {
      return recordRustContextualTargetType(request, context);
    },
    mapCheckedConversion(request, context) {
      return mapRustCheckedConversion(request, context, options);
    },
    resolveParameterPassing(request) {
      return resolveRustParameterPassing(request);
    },
    resolveRuntimeCarrier(request, context) {
      return resolveRustRuntimeCarrier(request, context, options);
    },
  };
}

function recordRustContextualTargetType(
  request: ContextualTargetTypeRequest,
  context: ExtensionObservationContext<"type.recordContextualTargetType">,
): ExtensionObservation<ContextualTargetTypeResult> {
  if (request.target !== undefined && request.target !== "rust") {
    return deferObservation;
  }
  const existing = context.facts.get(request.expression, contextualTargetTypeFactKey);
  if (existing !== undefined) {
    return acceptObservation(existing, [
      { message: "rust reused the TSTS-selected contextual source type" },
    ]);
  }
  return acceptObservation({ type: request.context }, [
    { message: "rust retained the TSTS-selected contextual source type for post-check target finalization" },
  ]);
}

function mapRustCheckedOperator(
  request: CheckedOperatorMappingRequest,
  context: ExtensionObservationContext<"operation.mapCheckedOperator">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedOperationMappingResult> {
  for (const sourceFile of context.compiler.getSourceFiles()) {
    if (sourceFile !== undefined) {
      options.sourceTypes.registerSourceFile(sourceFile, context.compiler.ast);
    }
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("operator");
  }
  let left = resolveRustTargetTypeRef(request.left, context, options);
  let right = resolveRustTargetTypeRef(request.right, context, options);
  left = normalizeSelectedLiteralCarrier(request.left, left, right, context, options);
  right = normalizeSelectedLiteralCarrier(request.right, right, left, context, options);
  if (request.operator === "=") {
    const selectedSet = mapSelectedAssignment(request, left, right, context, options);
    if (selectedSet !== undefined) {
      return selectedSet;
    }
    if (left === undefined || right === undefined || !rustTargetTypeRefEquals(left, right)) {
      return acceptPostCheckOperator(request);
    }
    return acceptRustOperation(request.expression, operatorFact("=", right), context, {
        sourceExpression: request.expression,
        sourceReceiver: request.left,
        sourceResultType: request.right,
      }, right);
  }
  if (request.operator === "??") {
    const inner = rustOptionElementCarrier(left);
    right = normalizeSelectedLiteralCarrier(request.right, right, inner, context, options);
    if (inner !== undefined && rustTargetTypeRefEquals(inner, right)) {
      return acceptRustOperation(request.expression, {
        kind: "option-coalesce",
        operationId: "tsonic.rust.option.coalesce",
      }, context, {
        sourceExpression: request.expression,
        sourceReceiver: request.left,
        sourceResultType: request.right,
      }, inner);
    }
    if (left !== undefined && right !== undefined && rustTargetTypeRefEquals(left, right) &&
      !isRustOptionCarrier(left) && !isRustNullishSourceCarrier(left)) {
      return acceptRustOperation(request.expression, {
        kind: "nullish-identity",
        operationId: "tsonic.rust.nullish.identity",
        resultCarrier: left,
      }, context, {
        sourceExpression: request.expression,
        sourceReceiver: request.left,
        sourceResultType: request.right,
      }, left);
    }
    return rejectSelectedOperation(request.expression, context, "RUST_NULLISH_COALESCE_CARRIER_MISMATCH", "Checked nullish coalescing requires an Option carrier and an exactly matching fallback carrier.");
  }
  if (request.right === undefined) {
    return mapSelectedUnaryOperator(request, left, context);
  }
  if (selectedGenericNumericLiteralCallCanRefine(request.left, context) ||
    selectedGenericNumericLiteralCallCanRefine(request.right, context)) {
    return acceptPostCheckOperator(request);
  }
  if ((request.operator === "===" || request.operator === "!==") &&
    ((isRustOptionCarrier(left) && isRustNullishSourceCarrier(right)) ||
      (isRustNullishSourceCarrier(left) && isRustOptionCarrier(right)))) {
    return acceptRustOperation(request.expression, {
      kind: "option-check",
      operationId: request.operator === "!=="
        ? "tsonic.rust.option.is-some"
        : "tsonic.rust.option.is-none",
      negated: request.operator === "!==",
      optionOperand: isRustOptionCarrier(left) ? "left" : "right",
    }, context, {
      sourceExpression: request.expression,
      sourceReceiver: request.left,
      sourceResultType: request.right,
    }, { kind: "source-primitive", name: "bool" });
  }
  const compound = selectRustCompoundAssignment(request.operator, left, right);
  if (compound !== undefined && left !== undefined) {
    return acceptRustOperation(request.expression, operatorFact(compound, left), context, {
      sourceExpression: request.expression,
      sourceReceiver: request.left,
      sourceResultType: request.right,
    });
  }
  const selected = selectRustBinaryOperator(request.operator, left, right);
  if (selected === undefined) {
    return acceptPostCheckOperator(request);
  }
  const fact: RustTargetOperationFact = selected.kind === "string-concat"
    ? {
        kind: "string-concat",
        operationId: "tsonic.rust.operator.concat.string",
        resultCarrier: selected.resultCarrier,
      }
    : operatorFact(selected.rustOperator, selected.resultCarrier);
  return acceptRustOperation(request.expression, fact, context, {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    sourceResultType: request.right,
  });
}

function selectedGenericNumericLiteralCallCanRefine(
  subject: ExtensionFactSubject | undefined,
  context: ExtensionObservationContext,
): boolean {
  const node = asNode(subject, context);
  if (node === undefined || context.compiler.ast.kindName(node) !== "KindCallExpression") {
    return false;
  }
  const selected = context.factResolver.resolve(node, selectedTargetSignatureFactKey);
  const sourceArguments = selected?.sourceSelectedMethodTypeArguments;
  const targetArguments = selected?.targetTypeArguments;
  if (selected === undefined || sourceArguments === undefined || targetArguments === undefined ||
    sourceArguments.length !== targetArguments.length) {
    return false;
  }
  const callArguments = context.compiler.ast.arguments(node);
  return sourceArguments.some((source, typeIndex) => {
    const target = targetArguments[typeIndex];
    if (source.explicitTypeNode !== undefined || target === undefined || !isRustNumericCarrier(target)) {
      return false;
    }
    return selected.member.parameters.some((parameter, parameterIndex) => {
      const argument = callArguments[parameterIndex];
      return parameter.type.kind === "type-parameter" && parameter.type.name === source.typeParameterName &&
        argument !== undefined && context.compiler.ast.kindName(argument) === "KindNumericLiteral";
    });
  });
}

function acceptPostCheckOperator(
  request: CheckedOperatorMappingRequest,
): ExtensionObservation<CheckedOperationMappingResult> {
  const unaryOperationId = request.right === undefined
    ? request.operator === "-"
      ? rustPostCheckUnaryMinusOperationId
      : request.operator === "+"
        ? rustPostCheckUnaryPlusOperationId
        : undefined
    : undefined;
  const operationId = unaryOperationId ?? rustPostCheckBinaryOperationId;
  const provenance: NonNullable<TargetOperationFact["provenance"]> = {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    ...(request.right === undefined ? {} : { sourceResultType: request.right }),
  };
  return acceptObservation({
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
  request: CheckedOperatorMappingRequest,
  operand: TargetTypeRef | undefined,
  context: ExtensionObservationContext<"operation.mapCheckedOperator">,
): ExtensionObservation<CheckedOperationMappingResult> {
  const operandNode = asNode(request.left, context);
  if ((request.operator === "-" || request.operator === "+") &&
    operandNode !== undefined && context.compiler.ast.kindName(operandNode) === "KindNumericLiteral") {
    return acceptPostCheckOperator(request);
  }
  let targetOperator: RustOperatorToken | undefined;
  let resultCarrier: TargetTypeRef | undefined;
  if (request.operator === "!" && isRustBoolCarrier(operand)) {
    targetOperator = "!";
    resultCarrier = operand;
  } else if (request.operator === "-" && isRustSignedNumericCarrier(operand)) {
    targetOperator = "-";
    resultCarrier = operand;
  } else if ((request.operator === "++" || request.operator === "--") && isRustIntegerCarrier(operand)) {
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
  request: CheckedOperatorMappingRequest,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
  context: ExtensionObservationContext<"operation.mapCheckedOperator">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedOperationMappingResult> | undefined {
  const selectedLeft = context.factResolver.resolve(request.left, targetOperationFactKey);
  const selectedDeclaration = selectedLeft?.provenance?.sourceSelectedDeclaration;
  const identity = resolveSelectedJsSourceMember(context, selectedDeclaration, options.sourceProfiles);
  if (identity === undefined || !options.jsEnabled) {
    return undefined;
  }
  const receiver = selectedLeft?.provenance?.sourceReceiver;
  const receiverCarrier = resolveRustTargetTypeRef(receiver, context, options);
  const operationKind = selectedLeft?.operationKind === "property"
    ? "property-set"
    : selectedLeft?.operationKind === "indexer"
      ? "index-set"
      : undefined;
  if (operationKind === undefined || receiverCarrier === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_EVIDENCE_MISSING", "Selected JavaScript assignment has no closed receiver or assignment-target evidence.");
  }
  const leftNode = asNode(request.left, context);
  const indexNode = operationKind === "index-set" && leftNode !== undefined
    ? ElementAccessExpression_ArgumentExpression(leftNode)
    : undefined;
  const assignmentSubjects = operationKind === "index-set"
    ? indexNode === undefined || request.right === undefined ? undefined : [indexNode, request.right]
    : request.right === undefined ? undefined : [request.right];
  if (assignmentSubjects === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_EVIDENCE_MISSING", "Selected JavaScript assignment has no closed index/value source evidence.");
  }
  const selection = selectJsSurfaceOperation({
    ownerName: identity.ownerName,
    memberName: identity.memberName,
    operationKind,
    receiverCarrier,
    argumentCarriers: assignmentSubjects.map((subject) =>
      resolveRustTargetTypeRef(subject, context, options)),
    argumentCompatibility: selectedArgumentCompatibility(assignmentSubjects, context, options),
  });
  if (selection === undefined || selection.fact.kind !== "runtime-set") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_UNSUPPORTED", `The selected JavaScript assignment '${identity.ownerName}.${identity.memberName}' has no closed Rust setter operation.`);
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

function resolveRustRuntimeCarrier(
  request: RuntimeCarrierFactRequest,
  context: ExtensionObservationContext<"type.resolveRuntimeCarrier">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<RuntimeCarrierFactResult> {
  const carrier = request.sourceTypeReference === undefined
    ? resolveRustTargetTypeRef(request.type, context, options)
    : resolveRustTargetTypeRef(request.sourceTypeReference, context, options) ??
      resolveRustTargetTypeRef(request.type, context, options);
  if (carrier === undefined || isRustNullishSourceCarrier(carrier)) {
    return deferObservation;
  }
  return acceptObservation({
    carrier,
    provenance: {
      sourceType: request.type,
      ...(request.sourceTypeReference === undefined ? {} : { sourceTypeReference: request.sourceTypeReference }),
      ...(request.sourceSymbol === undefined ? {} : { sourceSymbol: request.sourceSymbol }),
    },
  }, [{ message: "rust runtime carrier from selected source type evidence" }]);
}

function mapRustCheckedCall(
  request: CheckedCallMappingRequest,
  context: ExtensionObservationContext<"operation.mapCheckedCall">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedCallMappingResult> {
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
    request.sourceSelectedSignature,
    request.sourceCalleeDeclaration,
    request.sourceCalleeSymbol,
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked call carries conflicting selected provider declaration identities.");
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
      return rejectSelectedOperation(request.call, context, "RUST_PROVIDER_OPERATION_NOT_MAPPED", `No Rust operation row matches selected provider declaration '${providerIdentityText(provider)}' as ${operationKind}.`);
    }
    if (selection.kind === "ambiguous") {
      return rejectSelectedOperation(request.call, context, "RUST_PROVIDER_OPERATION_AMBIGUOUS", `Selected provider declaration '${providerIdentityText(provider)}' matches ${selection.rows.length} Rust operation rows.`);
    }
    return acceptSelectedCall(request, providerOperationFact(selection.row), selection.row.parameterCarriers, context, options, {
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
    request.sourceCalleeDeclaration,
    options.sourceProfiles,
  );
  if (selectedSourceMember === undefined && calleeSourceMember !== undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_SOURCE_DECLARATION_MISSING", "Checked source-profile call has callee evidence but no exact selected declaration evidence.");
  }
  if (selectedSourceMember !== undefined && calleeSourceMember !== undefined &&
    (selectedSourceMember.profile !== calleeSourceMember.profile ||
      selectedSourceMember.ownerName !== calleeSourceMember.ownerName ||
      selectedSourceMember.memberName !== calleeSourceMember.memberName)) {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_SOURCE_EVIDENCE_CONFLICT", "Checked source-profile call carries conflicting selected and callee declaration identities.");
  }
  if (selectedSourceMember?.ownerName === "ErrorConstructor" &&
    selectedSourceMember.memberName === "constructor" && checkedCallIsConstruction(request, context)) {
    if (request.arguments.length !== 1) {
      return rejectSelectedOperation(
        request.call,
        context,
        "RUST_ERROR_MESSAGE_REQUIRED",
        "Rust Error construction currently requires one checked string message argument.",
      );
    }
    const resultCarrier: TargetTypeRef = { kind: "target-named", id: "rust.runtime.JsError" };
    return acceptSelectedCall(request, {
      kind: "provider-operation",
      operationId: "tsonic.rust.error.constructor",
      operationKind: "constructor",
      target: { form: "call", path: "rt::JsError::new", argModes: ["ref"] },
      parameterCarriers: [rustStringTargetType()],
      resultCarrier,
      isAsync: false,
      isFallible: false,
    }, [rustStringTargetType()], context, options, {
      sourceName: "Error",
    });
  }
  if (selectedSourceMember?.profile === "js") {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.call, context, "RUST_JS_SURFACE_REQUIRED", "The selected call belongs to the explicit JavaScript source profile, which is not active.");
    }
    if (checkedCallIsConstruction(request, context)) {
      if (selectedSourceMember.ownerName === "RegExpConstructor") {
        return mapSelectedRegExpConstruction(request, context, options);
      }
      const typeArgumentCarriers = (request.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
        resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, options));
      const argumentCarriers = request.arguments.map((argument) =>
        resolveRustTargetTypeRef(argument, context, options));
      const selection = selectJsSurfaceConstructorBySourceOwner({
        sourceOwnerName: selectedSourceMember.ownerName,
        typeArgumentCarriers,
        argumentCarriers,
      });
      if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
        return rejectSelectedOperation(request.call, context, "RUST_SELECTED_OPERATION_UNSUPPORTED", `The selected JavaScript constructor '${selectedSourceMember.ownerName}' has no closed Rust operation row for the selected argument carriers.`);
      }
      return acceptSelectedCall(request, selection.fact, selection.parameterCarriers ?? [], context, options, {
        sourceName: selectedSourceMember.ownerName,
      });
    }
    const callee = asNode(request.callee, context);
    const receiver = callee === undefined ? undefined : Node_Expression(callee);
    const receiverCarrier = resolveRustTargetTypeRef(receiver, context, options);
    const argumentCarriers = request.arguments.map((argument) =>
      resolveRustTargetTypeRef(argument, context, options));
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
      argumentCompatibility: selectedArgumentCompatibility(request.arguments, context, options),
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(request.call, context, "RUST_SELECTED_OPERATION_UNSUPPORTED", `The selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no closed Rust operation row for the selected receiver and argument carriers.`);
    }
    const finalizedSelection = finalizeJsCallbackSelection(
      selection,
      resolveRustTargetTypeRef(request.sourceReturnType, context, options),
    );
    if (finalizedSelection === undefined || finalizedSelection.fact.kind !== "provider-operation") {
      return rejectSelectedOperation(request.call, context, "RUST_SELECTED_CALLBACK_CARRIER_MISSING", `Selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no closed callback/result carrier from TSTS-selected evidence.`);
    }
    const parameterCarriers = (finalizedSelection.parameterCarriers ?? []).map((carrier, index) =>
      carrier ?? argumentCarriers[index]);
    return acceptSelectedCall(request, finalizedSelection.fact, parameterCarriers, context, options, {
      sourceName: selectedSourceMember.memberName,
    });
  }

  const sourceDeclaration = isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)
    ? asNode(request.sourceSelectedDeclaration, context)
    : undefined;
  const calleeDeclaration = isProjectSourceDeclaration(context, request.sourceCalleeDeclaration)
    ? asNode(request.sourceCalleeDeclaration, context)
    : undefined;
  if (sourceDeclaration === undefined && calleeDeclaration !== undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_PROJECT_DECLARATION_MISSING", "Checked project-source call has callee evidence but no exact selected callable declaration evidence.");
  }
  if (sourceDeclaration !== undefined) {
    return acceptProjectSourceCall(request, sourceDeclaration, context, options);
  }

  return deferObservation;
}

function mapRustSourceMarkerCall(
  request: CheckedCallMappingRequest,
  provider: ProviderDeclarationIdentity,
  markerName: "out" | "ref" | "inref" | "borrow" | "borrowMut" | "move" | "struct" | "field" | "attribute" | "defaultof",
  context: ExtensionObservationContext<"operation.mapCheckedCall">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedCallMappingResult> {
  if (markerName !== "borrow" && markerName !== "borrowMut" && markerName !== "move") {
    return rejectSelectedOperation(
      request.call,
      context,
      "RUST_SOURCE_MARKER_UNSUPPORTED",
      `Rust does not support selected source marker '${markerName}' in this operation lane.`,
    );
  }
  const flow = context.factResolver.resolve(request.call, flowStateFactKey) ??
    context.facts.get(request.call, flowStateFactKey);
  const expectedState = markerName === "borrow"
    ? "borrowed-shared"
    : markerName === "borrowMut" ? "borrowed-mut" : "moved";
  if (flow?.state !== expectedState) {
    return rejectSelectedOperation(
      request.call,
      context,
      "RUST_FLOW_MARKER_FACT_NOT_PROVEN",
      `Selected Rust flow marker '${markerName}' requires finalized TSTS flow state '${expectedState}'.`,
    );
  }
  const [argument] = request.arguments;
  const carrier = resolveRustTargetTypeRef(request.sourceReturnType ?? argument, context, options) ??
    resolveRustTargetTypeRef(argument, context, options);
  if (argument === undefined || carrier === undefined) {
    return rejectSelectedOperation(
      request.call,
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
  context.facts.set(request.call, rustTargetOperationFactKey, fact, evidence);
  return acceptObservation({
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
      ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
      ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
      ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
    },
  }, evidence);
}

function mapSelectedRegExpConstruction(
  request: CheckedCallMappingRequest,
  context: ExtensionObservationContext<"operation.mapCheckedCall">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedCallMappingResult> {
  const [patternNode, flagsNode] = request.arguments.map((argument) => asNode(argument, context));
  const ast = context.compiler.ast;
  const pattern = patternNode !== undefined && ast.kindName(patternNode) === "KindStringLiteral"
    ? ast.text(patternNode)
    : undefined;
  const flags = flagsNode === undefined
    ? ""
    : ast.kindName(flagsNode) === "KindStringLiteral" ? ast.text(flagsNode) : undefined;
  if (pattern === undefined || flags === undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_REGEXP_DYNAMIC_UNSUPPORTED", "Rust RegExp construction requires TSTS-selected RegExp constructor evidence and compile-time string pattern/flags.");
  }
  const violation = options.regExpSubsetViolation(pattern, flags);
  if (violation !== undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_REGEXP_UNSUPPORTED", violation);
  }
  const resultCarrier: TargetTypeRef = { kind: "target-named", id: "rust.js.JsRegExp" };
  const fact: RustTargetOperationFact = {
    kind: "regexp-create",
    operationId: "tsonic.rust.js.regexp.create",
    pattern,
    flags,
  };
  const evidence = [{ message: "rust selected RegExp constructor" }];
  context.facts.set(request.call, rustTargetOperationFactKey, fact, evidence);
  context.facts.set(request.call, targetOperationFactKey, {
    operationId: fact.operationId,
    operationKind: "constructor",
    targetOperation: "js_abi::JsRegExp::new",
    resultType: resultCarrier,
    provenance: {
      sourceExpression: request.call,
      sourceCallee: request.callee,
      sourceSelectedSignature: request.sourceSelectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: request.sourceCalleeSymbol,
      sourceResultType: request.sourceReturnType,
    },
  }, evidence);
  return acceptObservation({
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
      ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
      ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
      ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
    },
  }, evidence);
}

function mapSelectedJsSpecialCall(
  request: CheckedCallMappingRequest,
  ownerName: string,
  memberName: string,
  context: ExtensionObservationContext<"operation.mapCheckedCall">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedCallMappingResult> | undefined {
  if (ownerName === "String" && memberName === "match") {
    const [argument] = request.arguments;
    const creation = argument === undefined
      ? undefined
      : context.factResolver.resolve(argument, rustTargetOperationFactKey);
    if (creation === undefined || creation.kind !== "regexp-create") {
      return rejectSelectedOperation(
        request.call,
        context,
        "RUST_REGEXP_MATCH_PATTERN_NOT_FINALIZED",
        "Rust String.match requires an inline RegExp whose checked construction fact finalizes the result shape.",
      );
    }
    const global = creation.flags.includes("g");
    const resultCarrier: TargetTypeRef = global
      ? rustOptionTargetType(rustVecTargetType(rustStringTargetType()))
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
    }, [{ kind: "target-named", id: "rust.js.JsRegExp" }], context, options, {
      sourceName: memberName,
    });
  }
  if (ownerName !== "JSON" || memberName !== "stringify" || request.arguments.length !== 3) {
    return undefined;
  }
  const [valueNode, replacerNode, spaceNode] = request.arguments.map((argument) => asNode(argument, context));
  const ast = context.compiler.ast;
  if (valueNode === undefined || replacerNode === undefined || spaceNode === undefined || ast.kindName(replacerNode) !== "KindNullKeyword") {
    return rejectSelectedOperation(request.call, context, "RUST_JSON_STRINGIFY_REPLACER_UNSUPPORTED", "Rust JSON.stringify supports the selected three-argument overload only with a null replacer and compile-time string/number indentation.");
  }
  let indent: string | undefined;
  if (ast.kindName(spaceNode) === "KindNumericLiteral") {
    indent = " ".repeat(Math.min(10, Math.max(0, Math.trunc(Number(ast.text(spaceNode))))));
  } else if (ast.kindName(spaceNode) === "KindStringLiteral") {
    indent = ast.text(spaceNode).slice(0, 10);
  }
  if (indent === undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_JSON_STRINGIFY_INDENT_UNSUPPORTED", "Rust JSON.stringify indentation must be a compile-time string or number selected by the checked source call.");
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
  }, [rustJsValueTargetType()], context, options, {
    sourceName: memberName,
  });
}

function finalizeJsCallbackSelection(
  selection: JsOperationSelection | undefined,
  selectedReturnCarrier: TargetTypeRef | undefined,
): JsOperationSelection | undefined {
  if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.callbackShape === undefined) {
    return selection;
  }
  const callback = selection.parameterCarriers?.[0];
  if (callback?.kind !== "function-pointer" || selectedReturnCarrier === undefined) {
    return undefined;
  }
  if (selection.callbackShape === "map") {
    if (selectedReturnCarrier.kind !== "array") {
      return undefined;
    }
    const parameterCarriers = [
      { ...callback, result: selectedReturnCarrier.element },
      ...(selection.parameterCarriers?.slice(1) ?? []),
    ];
    return {
      ...selection,
      fact: { ...selection.fact, resultCarrier: selectedReturnCarrier, parameterCarriers },
      resultCarrier: selectedReturnCarrier,
      parameterCarriers,
    };
  }
  const parameterCarriers = [
    { ...callback, args: [selectedReturnCarrier, ...callback.args.slice(1)], result: selectedReturnCarrier },
    selectedReturnCarrier,
  ];
  return {
    ...selection,
    fact: { ...selection.fact, resultCarrier: selectedReturnCarrier, parameterCarriers },
    resultCarrier: selectedReturnCarrier,
    parameterCarriers,
  };
}

function acceptProjectSourceCall(
  request: CheckedCallMappingRequest,
  selectedDeclaration: Node,
  context: ExtensionObservationContext<"operation.mapCheckedCall">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedCallMappingResult> {
  const { ast } = context.compiler;
  const selectedKind = ast.kindName(selectedDeclaration);
  const construction = checkedCallIsConstruction(request, context);
  if (construction && selectedKind === "KindClassDeclaration") {
    const members = ast.members(selectedDeclaration);
    if (!isDenseDataArray(members) || members.some((member) => member === undefined)) {
      return rejectSelectedOperation(request.call, context, "RUST_SELECTED_CONSTRUCTOR_DECLARATION_MALFORMED", "Project-source class declaration contains an undefined or non-data member slot.");
    }
    const constructors = (members as readonly Node[]).filter((member) =>
      ast.kindName(member) === "KindConstructor");
    if (constructors.length !== 0 || request.arguments.length !== 0) {
      return rejectSelectedOperation(request.call, context, "RUST_SELECTED_CONSTRUCTOR_DECLARATION_MISSING", "A project-source construction with an explicit constructor requires that exact TSTS-selected constructor declaration; class-level fallback is allowed only for the implicit zero-argument constructor.");
    }
  }
  if (construction && selectedKind !== "KindClassDeclaration" && selectedKind !== "KindConstructor") {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_CONSTRUCTOR_DECLARATION_INVALID", "Project-source construction evidence is not an exact constructor declaration or an implicit-constructor class declaration.");
  }
  const callableDeclaration = selectedDeclaration;
  const targetTypeArguments = mapSelectedTargetTypeArguments(request, context, options);
  if (targetTypeArguments === undefined && (request.sourceSelectedMethodTypeArguments?.length ?? 0) > 0) {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_TYPE_ARGUMENT_CARRIER_MISSING", "A TSTS-selected project-source method type argument could not map to a closed Rust target type.");
  }
  const parameters = ast.parameters(callableDeclaration).map((parameter, index) => {
    if (parameter === undefined) {
      return undefined;
    }
    const abi = options.sourceCallableAbi.resolveParameterAbi(parameter, context, options);
    if (abi === undefined) {
      return undefined;
    }
    context.facts.set(parameter, rustSourceParameterAbiFactKey, {
      parameterCarrier: abi.parameterCarrier,
      mode: abi.mode,
    }, [
      { message: "rust finalized project-source parameter ABI" },
    ]);
    return {
      name: ast.text(ast.name(parameter)) || `arg${index}`,
      type: abi.parameterCarrier,
      passingMode: abi.mode === "mut-ref"
        ? "borrow-mut" as const
        : abi.mode === "ref" ? "borrow-shared" as const : "by-value" as const,
    };
  });
  if (parameters.some((parameter) => parameter === undefined)) {
    return rejectSelectedOperation(request.call, context, "RUST_SOURCE_CALL_PARAMETER_CARRIER_MISSING", "The exact TSTS-selected project-source declaration has a parameter without a closed Rust target carrier.");
  }
  let returnType: TargetTypeRef | undefined;
  if (construction) {
    const classDeclaration = selectedKind === "KindClassDeclaration"
      ? selectedDeclaration
      : ast.parent(callableDeclaration);
    returnType = classDeclaration === undefined
      ? undefined
      : resolveRustTargetTypeRef(classDeclaration, context, options);
  } else {
    const sourceReturn = Node_Type(callableDeclaration) ?? request.sourceReturnType;
    returnType = sourceReturn === undefined
      ? undefined
      : resolveRustTargetTypeRef(sourceReturn, context, options);
  }
  if (returnType === undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_SOURCE_CALL_RETURN_CARRIER_MISSING", "The exact TSTS-selected project-source declaration has no closed Rust return carrier.");
  }
  const sourceName = ast.text(ast.name(callableDeclaration)) || (construction ? "constructor" : "<anonymous>");
  const fileName = ast.getFileName(ast.getSourceFile(callableDeclaration));
  const member: TargetMember = {
    id: `tsonic.rust.source.call:${fileName}:${ast.pos(callableDeclaration)}:${ast.end(callableDeclaration)}`,
    sourceName,
    targetName: sourceName,
    kind: construction ? "constructor" : "method",
    parameters: parameters as NonNullable<TargetMember["parameters"]>,
    returnType,
  };
  return acceptObservation({
    selectedSignature: {
      member,
      sourceDeclaration: callableDeclaration,
      ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
      ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
      ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
      ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
      ...(request.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.sourceSelectedMethodTypeArguments }),
      ...(targetTypeArguments === undefined ? {} : { targetTypeArguments }),
    },
  }, [{ message: `rust selected project-source call ${member.id}` }]);
}

function mapSelectedTargetTypeArguments(
  request: CheckedCallMappingRequest,
  context: ExtensionObservationContext,
  options: RustOperationsProviderOptions,
): readonly TargetTypeRef[] | undefined {
  const sourceArguments = request.sourceSelectedMethodTypeArguments;
  if (sourceArguments === undefined || sourceArguments.length === 0) {
    return undefined;
  }
  const mapped = sourceArguments.map((argument) =>
    resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, options));
  return mapped.every((argument) => argument !== undefined)
    ? mapped as TargetTypeRef[]
    : undefined;
}

function acceptSelectedCall(
  request: CheckedCallMappingRequest,
  template: RustProviderOperationTemplate,
  parameterCarriers: readonly (TargetTypeRef | undefined)[] | undefined,
  context: ExtensionObservationContext<"operation.mapCheckedCall">,
  resolutionOptions: RustOperationsProviderOptions,
  callIdentity: {
    readonly sourceName: string;
    readonly providerDeclaration?: ProviderDeclarationIdentity;
  },
): ExtensionObservation<CheckedCallMappingResult> {
  const sourceArguments = selectedCallSourceCarriers(
    request,
    template,
    parameterCarriers,
    context,
    resolutionOptions,
  );
  if (sourceArguments.kind === "missing") {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_PARAMETER_CARRIER_MISSING", `Selected call '${callIdentity.sourceName}' has no closed Rust carrier for every target parameter.`);
  }
  if (sourceArguments.kind === "incompatible") {
    return rejectSelectedOperation(
      request.call,
      context,
      "RUST_CALL_ARGUMENT_CONVERSION_UNSUPPORTED",
      "The TSTS-selected call argument cannot be represented by the selected Rust target parameter carrier.",
    );
  }
  const receiverSubject = selectedCallReceiverSubject(request, context, template.target);
  const sourceReceiverCarrier = receiverSubject === undefined
    ? undefined
    : resolveRustTargetTypeRef(receiverSubject, context, resolutionOptions);
  if (providerFormRequiresSourceReceiver(template.target) && sourceReceiverCarrier === undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_RECEIVER_CARRIER_MISSING", `Selected call '${callIdentity.sourceName}' has no closed Rust receiver carrier.`);
  }
  const fact = finalizeProviderOperationFact(template, sourceArguments.carriers, sourceReceiverCarrier);
  if (fact === undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `Selected call '${callIdentity.sourceName}' cannot finalize one total Rust operation ABI.`);
  }
  const targetTypeArguments = request.sourceSelectedMethodTypeArguments?.map((argument) =>
    resolveRustTargetTypeRef(argument.explicitTypeNode ?? argument.selectedType, context, resolutionOptions));
  if (targetTypeArguments?.some((argument) => argument === undefined) === true) {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_TYPE_ARGUMENT_CARRIER_MISSING", `Selected generic call '${callIdentity.sourceName}' has a source-selected type argument that cannot map to a closed Rust target type.`);
  }
  const resultCarrier = fact.resultCarrier;
  const operation: TargetOperationFact = {
    operationId: fact.operationId,
    operationKind: fact.abi.operationKind,
    targetOperation: rustTargetOperationText(fact),
    resultType: resultCarrier,
    provenance: {
      sourceExpression: request.call,
      sourceCallee: request.callee,
      sourceSelectedSignature: request.sourceSelectedSignature,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceSelectedSymbol: request.sourceCalleeSymbol,
      sourceResultType: request.sourceReturnType,
      ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
    },
  };
  const evidence = [{ message: `rust selected call ${fact.operationId}` }];
  context.facts.set(request.call, rustTargetOperationFactKey, {
    ...fact,
  }, evidence);
  context.facts.set(request.call, targetOperationFactKey, operation, evidence);
  const member: TargetMember = {
    id: fact.operationId,
    sourceName: callIdentity.sourceName,
    targetName: operation.targetOperation,
    kind: fact.abi.operationKind === "constructor" ? "constructor" : "method",
    parameters: fact.abi.sourceArguments.map((argument, index) => ({
      name: `arg${index}`,
      type: argument.carrier,
      passingMode: rustArgumentPassingMode(argument.mode),
    })),
    returnType: resultCarrier,
    ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
  };
  return acceptObservation({
    selectedSignature: {
      member,
      ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
      ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
      ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
      ...(request.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.sourceSelectedMethodTypeArguments }),
      ...(targetTypeArguments === undefined ? {} : { targetTypeArguments: targetTypeArguments as TargetTypeRef[] }),
      ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
    },
  }, evidence);
}

type SelectedCallSourceCarriers =
  | { readonly kind: "resolved"; readonly carriers: readonly TargetTypeRef[] }
  | { readonly kind: "missing" }
  | { readonly kind: "incompatible"; readonly sourceIndex: number };

function selectedCallSourceCarriers(
  request: CheckedCallMappingRequest,
  fact: RustProviderOperationTemplate,
  declared: readonly (TargetTypeRef | undefined)[] | undefined,
  context: ExtensionObservationContext<"operation.mapCheckedCall">,
  options: RustOperationsProviderOptions,
): SelectedCallSourceCarriers {
  const compileTimeIndexes = new Set(fact.compileTimeSourceArgumentIndexes ?? []);
  const runtimeIndexes = request.arguments
    .map((_argument, index) => index)
    .filter((index) => !compileTimeIndexes.has(index));
  const declaredBySourceIndex = new Map<number, TargetTypeRef | undefined>();
  for (const [declaredIndex, sourceIndex] of runtimeIndexes.entries()) {
    declaredBySourceIndex.set(sourceIndex, declared?.[declaredIndex]);
  }
  let incompatibleIndex: number | undefined;
  const actual = request.arguments.map((argument, index) => {
    const expected = declaredBySourceIndex.get(index);
    const resolved = resolveRustTargetTypeRef(argument, context, options);
    const normalized = normalizeSelectedArgumentCarrier(argument, resolved, expected, context, options);
    if (normalized !== undefined && expected !== undefined && !rustTargetTypeRefEquals(normalized, expected)) {
      incompatibleIndex ??= index;
    }
    return normalized ?? expected;
  });
  if (incompatibleIndex !== undefined) {
    return { kind: "incompatible", sourceIndex: incompatibleIndex };
  }
  if (actual.some((carrier) => carrier === undefined)) {
    return { kind: "missing" };
  }
  if (fact.target.form === "call-str-slice") {
    const stringCarrier = rustStringTargetType();
    return actual.every((carrier) => carrier !== undefined && rustTargetTypeRefEquals(carrier, stringCarrier))
      ? { kind: "resolved", carriers: actual as TargetTypeRef[] }
      : { kind: "incompatible", sourceIndex: 0 };
  }
  if (fact.target.form === "call-jsvalue-slice") {
    if (actual.length === 0 || !rustTargetTypeRefEquals(actual[0], rustStringTargetType())) {
      return { kind: "incompatible", sourceIndex: 0 };
    }
    const jsValue = rustJsValueTargetType();
    return actual.slice(1).every((carrier) => carrier !== undefined && rustTargetTypeRefEquals(carrier, jsValue))
      ? { kind: "resolved", carriers: actual as TargetTypeRef[] }
      : { kind: "incompatible", sourceIndex: 1 };
  }
  return { kind: "resolved", carriers: actual as TargetTypeRef[] };
}

function selectedCallReceiverSubject(
  request: CheckedCallMappingRequest,
  context: ExtensionObservationContext,
  form: RustProviderOperationForm,
): ExtensionFactSubject | undefined {
  if (!providerFormRequiresSourceReceiver(form)) {
    return undefined;
  }
  const callee = asNode(request.callee, context);
  return callee === undefined || context.compiler.ast.kindName(callee) !== "KindPropertyAccessExpression"
    ? undefined
    : Node_Expression(callee);
}

function providerFormRequiresSourceReceiver(form: RustProviderOperationForm): boolean {
  return form.form === "method" ||
    form.form === "field" ||
    form.form === "index" ||
    form.form === "free-call" ||
    form.form === "receiver-method" ||
    form.form === "arg-receiver-method";
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
    ...(template.resultConversion === undefined ? {} : { resultConversion: template.resultConversion }),
    isAsync: template.isAsync,
    isFallible: template.isFallible,
  });
  if (abi === undefined) {
    return undefined;
  }
  return {
    kind: "provider-operation",
    operationId: template.operationId,
    resultCarrier: abi.result.kind === "async" ? abi.result.futureCarrier : abi.result.carrier,
    abi,
  };
}

function resolveRustParameterPassing(
  request: ParameterPassingRequest,
): ExtensionObservation<ParameterPassingResult> {
  const index = request.parameterIndex;
  const selectedParameter = index === undefined
    ? undefined
    : request.selectedSignature?.member.parameters[index];
  if (index === undefined || request.targetParameter === undefined || selectedParameter === undefined || selectedParameter !== request.targetParameter) {
    return rejectObservation({
      extensionId: "tsonic.rust.operations",
      extensionCode: "RUST_PARAMETER_PASSING_EVIDENCE_MISSING",
      numericCode: 0,
      category: "error",
      message: "Rust parameter passing requires the exact TSTS-selected target parameter and parameter index.",
      evidence: [{ message: "target.capability=rust.parameter-passing" }],
    });
  }
  const mode = selectedParameter.passingMode;
  if (mode !== "by-value" && mode !== "borrow-shared" && mode !== "borrow-mut" && mode !== "move") {
    return rejectObservation({
      extensionId: "tsonic.rust.operations",
      extensionCode: "RUST_PARAMETER_PASSING_MODE_UNSUPPORTED",
      numericCode: 0,
      category: "error",
      message: `Rust does not support selected target parameter mode '${mode}'.`,
      evidence: [{ message: "target.capability=rust.parameter-passing" }],
    });
  }
  return acceptObservation({
    passing: {
      mode,
      ...(request.argument === undefined ? {} : { targetExpression: request.argument }),
    },
  }, [{ message: `rust selected parameter ${index} passing mode ${mode}` }]);
}

function checkedCallIsConstruction(
  request: CheckedCallMappingRequest,
  context: ExtensionObservationContext,
): boolean {
  const call = asNode(request.call, context);
  return call !== undefined && context.compiler.ast.kindName(call) === "KindNewExpression";
}

function mapRustCheckedPropertyAccess(
  request: CheckedPropertyAccessMappingRequest,
  context: ExtensionObservationContext<"operation.mapCheckedPropertyAccess">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedOperationMappingResult> {
  if (request.optionalChain === true) {
    return rejectSelectedOperation(request.expression, context, "RUST_OPTIONAL_CHAIN_UNSUPPORTED", "Optional-chain property access has no finalized Rust Option operation.");
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("property");
  }
  if (selectedDeclarationIsCallable(request.sourceSelectedDeclaration, context)) {
    return acceptDeclarationOperation("property");
  }
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
    request.sourceSelectedSymbol,
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked property access carries conflicting selected provider declaration identities.");
  }
  if (providerEvidence.kind === "selected") {
    return mapProviderCheckedOperation(request.expression, providerEvidence.identity, "property", context, options, request.receiver, []);
  }

  const jsIdentity = resolveSelectedJsSourceMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (jsIdentity !== undefined) {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.expression, context, "RUST_JS_SURFACE_REQUIRED", "The selected property belongs to the explicit JavaScript source profile, which is not active.");
    }
    const receiverCarrier = resolveRustTargetTypeRef(request.receiver, context, options);
    const selection = selectJsSurfaceOperation({
      ownerName: jsIdentity.ownerName,
      memberName: jsIdentity.memberName,
      operationKind: "property",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_UNSUPPORTED", `The selected JavaScript property '${jsIdentity.ownerName}.${jsIdentity.memberName}' has no closed Rust operation row for this receiver carrier.`);
    }
    const fact = finalizeProviderOperationFromSubjects(selection.fact, request.receiver, [], context, options);
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `The selected JavaScript property '${jsIdentity.ownerName}.${jsIdentity.memberName}' cannot finalize one total Rust operation ABI.`);
    }
    return acceptRustOperation(request.expression, fact, context, {
      sourceExpression: request.expression,
      sourceReceiver: request.receiver,
      sourceSelectedSymbol: request.sourceSelectedSymbol,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration,
      sourceResultType: request.sourceResultType,
    });
  }

  if (isProjectSourceDeclaration(context, request.sourceSelectedDeclaration)) {
    const declaration = request.sourceSelectedDeclaration;
    const memberName = context.compiler.ast.text(context.compiler.ast.name(declaration));
    if (context.compiler.ast.kindName(declaration) === "KindEnumMember") {
      const enumDeclaration = context.compiler.ast.parent(declaration);
      const enumName = enumDeclaration === undefined
        ? ""
        : context.compiler.ast.text(context.compiler.ast.name(enumDeclaration));
      const enumFileName = enumDeclaration === undefined
        ? ""
        : context.compiler.ast.getFileName(context.compiler.ast.getSourceFile(enumDeclaration));
      const resultCarrier = enumName.length === 0 || enumFileName.length === 0
        ? undefined
        : rustSourceTypeCarrier(enumFileName, enumName, "enum");
      if (memberName.length > 0 && resultCarrier !== undefined) {
        const operationId = sourceOperationId(context, declaration, "enum-member");
        return acceptRustOperation(request.expression, {
          kind: "source-enum-member",
          operationId,
          name: memberName,
          resultCarrier,
        }, context, {
          sourceExpression: request.expression,
          sourceReceiver: request.receiver,
          sourceSelectedSymbol: request.sourceSelectedSymbol,
          sourceSelectedDeclaration: declaration,
          sourceResultType: request.sourceResultType,
        });
      }
    }
    const resultCarrier = resolveRustTargetTypeRef(Node_Type(declaration) ?? request.sourceResultType, context, options);
    if (memberName.length > 0 && resultCarrier !== undefined) {
      const operationId = sourceOperationId(context, declaration, "field");
      return acceptRustOperation(request.expression, {
        kind: "source-field",
        operationId,
        name: memberName,
        resultCarrier,
      }, context, {
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

function mapRustCheckedElementAccess(
  request: CheckedElementAccessMappingRequest,
  context: ExtensionObservationContext<"operation.mapCheckedElementAccess">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedOperationMappingResult> {
  if (request.optionalChain === true) {
    return rejectSelectedOperation(request.expression, context, "RUST_OPTIONAL_CHAIN_UNSUPPORTED", "Optional-chain element access has no finalized Rust Option operation.");
  }
  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("indexer");
  }
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
    request.sourceSelectedSymbol,
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked element access carries conflicting selected provider declaration identities.");
  }
  if (providerEvidence.kind === "selected") {
    return mapProviderCheckedOperation(request.expression, providerEvidence.identity, "indexer", context, options, request.receiver, [request.argument]);
  }

  const receiverCarrier = resolveRustTargetTypeRef(request.receiver, context, options);
  if (receiverCarrier?.kind === "tuple") {
    const index = request.sourceSelectedElementIndex;
    const resultCarrier = index === undefined ? undefined : receiverCarrier.elements[index];
    if (index === undefined || resultCarrier === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_TUPLE_INDEX_NOT_PROVEN", "Tuple element access requires a TSTS-selected fixed ordinal within the tuple bounds.");
    }
    return acceptRustOperation(request.expression, {
      kind: "tuple-index",
      operationId: `tsonic.rust.tuple.index.${index}`,
      index,
      resultCarrier,
    }, context, elementProvenance(request));
  }
  const fixedReceiver = rustFixedArrayCarrierValue(receiverCarrier);
  if (fixedReceiver !== undefined) {
    const index = request.sourceSelectedElementIndex;
    if (index === undefined || index < 0 || index >= fixedReceiver.length) {
      return rejectSelectedOperation(request.expression, context, "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN", "Fixed-array element access requires a TSTS-selected in-range fixed ordinal.");
    }
    return acceptRustOperation(request.expression, {
      kind: "fixed-index",
      operationId: "tsonic.rust.fixed-array.index",
      index,
    }, context, elementProvenance(request), fixedReceiver.element);
  }

  const sourceProfileIdentity = resolveSelectedSourceProfileMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  const nativeArrayReceiver = receiverCarrier?.kind === "array"
    ? receiverCarrier
    : receiverCarrier?.kind === "pointer" && receiverCarrier.pointee.kind === "array"
      ? receiverCarrier.pointee
      : undefined;
  if (sourceProfileIdentity?.profile === "native" &&
    (sourceProfileIdentity.ownerName === "Array" || sourceProfileIdentity.ownerName === "ReadonlyArray") &&
    sourceProfileIdentity.memberName === "index" &&
    nativeArrayReceiver !== undefined && isCopyProvenCarrier(nativeArrayReceiver.element)) {
    const template: RustProviderOperationTemplate = {
      kind: "provider-operation",
      operationId: `tsonic.rust.native.${sourceProfileIdentity.ownerName}.index`,
      operationKind: "indexer",
      target: { form: "index", indexConversion: rustInt32ToUsizeValueConversion },
      resultCarrier: nativeArrayReceiver.element,
      parameterCarriers: [rustSourcePrimitiveTargetType("int32")],
      isAsync: false,
      isFallible: false,
    };
    const fact = finalizeProviderOperationFromSubjects(template, request.receiver, [request.argument], context, options);
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", "Native array indexing cannot finalize one total Rust operation ABI.");
    }
    return acceptRustOperation(request.expression, fact, context, elementProvenance(request));
  }

  const jsIdentity = resolveSelectedJsSourceMember(context, request.sourceSelectedDeclaration, options.sourceProfiles);
  if (jsIdentity !== undefined) {
    if (!options.jsEnabled) {
      return rejectSelectedOperation(request.expression, context, "RUST_JS_SURFACE_REQUIRED", "The selected index signature belongs to the explicit JavaScript source profile, which is not active.");
    }
    const selection = selectJsSurfaceOperation({
      ownerName: jsIdentity.ownerName,
      memberName: jsIdentity.memberName,
      operationKind: "indexer",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      argumentCarriers: [resolveRustTargetTypeRef(request.argument, context, options)],
      argumentCompatibility: selectedArgumentCompatibility([request.argument], context, options),
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_UNSUPPORTED", `The selected JavaScript index signature '${jsIdentity.ownerName}' has no closed Rust operation row for this receiver carrier.`);
    }
    const fact = finalizeProviderOperationFromSubjects(selection.fact, request.receiver, [request.argument], context, options);
    if (fact === undefined) {
      return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `The selected JavaScript indexer '${jsIdentity.ownerName}.${jsIdentity.memberName}' cannot finalize one total Rust operation ABI.`);
    }
    return acceptRustOperation(request.expression, fact, context, elementProvenance(request));
  }

  if (isDeclarationFileSubject(request.expression, context)) {
    return acceptDeclarationOperation("indexer");
  }
  return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_EVIDENCE_MISSING", "Checked element access has no selected provider, source-profile, tuple, or fixed-array evidence.");
}

function mapRustCheckedIteration(
  request: CheckedIterationMappingRequest,
  context: ExtensionObservationContext<"operation.mapCheckedIteration">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedOperationMappingResult> {
  if (request.kind !== "for-of") {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_KIND_UNSUPPORTED",
      `Rust target iteration does not support selected '${request.kind}' semantics.`,
    );
  }
  const iterable = resolveRustTargetTypeRef(request.expression, context, options);
  const iterableElement = rustIterableElementCarrier(iterable);
  if (request.sourceElementType === undefined) {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_SELECTED_ELEMENT_MISSING",
      "Selected for-of iteration has no TSTS-selected source element carrier.",
    );
  }
  if (iterableElement === undefined) {
    return rejectSelectedOperation(
      request.statement,
      context,
      "RUST_ITERATION_CARRIER_UNSUPPORTED",
      "Selected for-of iteration receiver is not a finalized supported Rust iterable carrier.",
    );
  }
  const elementCarrier = iterableElement;
  const fact: RustTargetOperationFact = {
    kind: "for-of",
    operationId: "tsonic.rust.iteration.for-of.sync",
    elementCarrier,
    style: isCopyProvenCarrier(elementCarrier) ? "copied" : "cloned",
  };
  recordIterationInitializerCarrier(request.initializer, elementCarrier, context);
  return acceptRustOperation(request.statement, fact, context, {
    sourceExpression: request.expression,
    sourceResultType: request.sourceElementType,
  }, elementCarrier);
}

function rustIterableElementCarrier(iterable: TargetTypeRef | undefined): TargetTypeRef | undefined {
  if (iterable?.kind === "array") {
    return iterable.element;
  }
  if (iterable?.kind === "pointer" && iterable.pointee.kind === "array") {
    return iterable.pointee.element;
  }
  const fixed = rustFixedArrayCarrierValue(iterable);
  if (fixed !== undefined) {
    return fixed.element;
  }
  return isRustJsArrayCarrier(iterable) ? iterable?.typeArguments?.[0] : undefined;
}

function recordIterationInitializerCarrier(
  initializer: ExtensionFactSubject | undefined,
  carrier: TargetTypeRef,
  context: ExtensionObservationContext,
): void {
  const root = asNode(initializer, context);
  if (root === undefined) {
    return;
  }
  const evidence = [{ message: "rust selected iteration binding carrier" }];
  const visit = (node: Node): void => {
    const kind = context.compiler.ast.kindName(node);
    if (node === root || kind === "KindVariableDeclaration") {
      context.facts.set(node, runtimeCarrierFactKey, { carrier }, evidence);
    }
    if (kind === "KindVariableDeclaration" || node === root) {
      for (const child of context.compiler.ast.children(node)) {
        if (child !== undefined) {
          visit(child);
        }
      }
    }
  };
  visit(root);
}

function mapRustCheckedConversion(
  request: CheckedConversionMappingRequest,
  context: ExtensionObservationContext<"operation.mapCheckedConversion">,
  options: RustOperationsProviderOptions,
): ExtensionObservation<CheckedConversionMappingResult> {
  if (request.conversionKind === "call-argument") {
    const targetCarrier = request.targetParameter.type;
    const selectedTypeParameterNames = new Set(
      request.selectedSignature.sourceSelectedMethodTypeArguments?.map((argument) => argument.typeParameterName) ?? [],
    );
    if (selectedTypeParameterNames.size > 0 &&
      targetTypeContainsSelectedParameter(targetCarrier, selectedTypeParameterNames)) {
      return acceptObservation({}, [
        { message: "rust deferred the selected generic source-call argument carrier to post-check target substitution" },
      ]);
    }
    const sourceCarrier = resolveRustTargetTypeRef(request.expression, context, options);
    if (sourceCarrier !== undefined && rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
      return acceptObservation({ convertedType: targetCarrier }, [
        { message: "rust selected call argument already has the selected target parameter carrier" },
      ]);
    }
    const sourceNode = asNode(request.expression, context);
    const sourceKind = sourceNode === undefined ? "" : context.compiler.ast.kindName(sourceNode);
    if (targetCarrier.kind === "function-pointer" &&
      (sourceKind === "KindArrowFunction" || sourceKind === "KindFunctionExpression")) {
      return acceptObservation({ convertedType: targetCarrier }, [
        { message: "rust selected function expression uses the selected target function-pointer carrier" },
      ]);
    }
    if (targetCarrier.kind === "source-primitive" && sourceNode !== undefined &&
      sourceLiteralIsRepresentableAsPrimitive(sourceNode, targetCarrier.name, context)) {
      return acceptObservation({ convertedType: targetCarrier }, [
        { message: "rust selected literal is representable by the selected target primitive carrier" },
      ]);
    }
    if (targetCarrier.kind === "pointer" && sourceCarrier !== undefined &&
      rustTargetTypeRefEquals(targetCarrier.pointee, sourceCarrier)) {
      return acceptObservation({ convertedType: targetCarrier }, [
        { message: "rust selected call argument borrows into the selected target pointer carrier" },
      ]);
    }
    const optionElement = rustOptionElementCarrier(targetCarrier);
    if (optionElement !== undefined) {
      if (isRustNullishSourceCarrier(sourceCarrier)) {
        return acceptObservation({ convertedType: targetCarrier }, [
          { message: "rust selected nullish argument maps to the selected Option carrier" },
        ]);
      }
      if (rustTargetTypeRefEquals(sourceCarrier, optionElement) ||
        (sourceNode !== undefined && optionElement.kind === "source-primitive" &&
          sourceLiteralIsRepresentableAsPrimitive(sourceNode, optionElement.name, context))) {
        return acceptObservation({ convertedType: targetCarrier }, [
          { message: "rust selected value argument maps to the selected Option element carrier" },
        ]);
      }
    }
    if (sourceCarrier === undefined) {
      return acceptObservation({}, [
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
  const sourceCarrier = resolveRustTargetTypeRef(request.sourceExpression, context, options);
  if (targetCarrier === undefined || sourceCarrier === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_ASSERTION_CARRIER_MISSING",
      "Checked source assertion has no closed source and target Rust carriers from TSTS evidence.",
    );
  }
  const identity = rustTargetTypeRefEquals(sourceCarrier, targetCarrier);
  const conversion = identity ? undefined : selectRustSourceValueConversion(sourceCarrier, targetCarrier);
  if (!identity && conversion === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_ASSERTION_UNSUPPORTED",
      "Checked source assertion does not map to an identity or explicit Rust runtime conversion.",
    );
  }
  const operationId = identity
    ? "tsonic.rust.conversion.identity"
    : `tsonic.rust.conversion.${conversion!.id}`;
  const fact: RustTargetOperationFact = {
    kind: "source-conversion",
    operationId,
    ...(conversion === undefined ? {} : { conversion }),
    resultCarrier: targetCarrier,
  };
  const operation: TargetOperationFact = {
    operationId,
    operationKind: "operator",
    targetOperation: identity ? "identity" : "runtime-conversion",
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
    : `rust selected assertion conversion '${conversion!.id}'` }];
  context.facts.set(request.expression, rustTargetOperationFactKey, fact, evidence);
  return acceptObservation({ convertedType: targetCarrier, operation }, evidence);
}

function targetTypeContainsSelectedParameter(
  type: TargetTypeRef,
  selectedNames: ReadonlySet<string>,
): boolean {
  switch (type.kind) {
    case "type-parameter":
      return selectedNames.has(type.name);
    case "target-named":
      return type.typeArguments?.some((argument) => targetTypeContainsSelectedParameter(argument, selectedNames)) === true;
    case "array":
      return targetTypeContainsSelectedParameter(type.element, selectedNames);
    case "tuple":
      return type.elements.some((element) => targetTypeContainsSelectedParameter(element, selectedNames));
    case "pointer":
      return targetTypeContainsSelectedParameter(type.pointee, selectedNames);
    case "function-pointer":
      return type.args.some((argument) => targetTypeContainsSelectedParameter(argument, selectedNames)) ||
        targetTypeContainsSelectedParameter(type.result, selectedNames);
    case "associated-type":
      return targetTypeContainsSelectedParameter(type.owner, selectedNames);
    default:
      return false;
  }
}

function mapProviderCheckedOperation(
  expression: ExtensionFactSubject,
  identity: ProviderDeclarationIdentity,
  operationKind: RustProviderOperationRow["operationKind"],
  context: ExtensionObservationContext,
  options: RustOperationsProviderOptions,
  sourceReceiver: ExtensionFactSubject | undefined,
  sourceArguments: readonly ExtensionFactSubject[],
): ExtensionObservation<CheckedOperationMappingResult> {
  const selection = selectRustProviderOperation(options.providerRows, identity, operationKind);
  if (selection.kind === "missing") {
    return rejectSelectedOperation(expression, context, "RUST_PROVIDER_OPERATION_NOT_MAPPED", `No Rust operation row matches selected provider declaration '${providerIdentityText(identity)}' as ${operationKind}.`);
  }
  if (selection.kind === "ambiguous") {
    return rejectSelectedOperation(expression, context, "RUST_PROVIDER_OPERATION_AMBIGUOUS", `Selected provider declaration '${providerIdentityText(identity)}' matches ${selection.rows.length} Rust operation rows.`);
  }
  const template = providerOperationFact(selection.row);
  const fact = finalizeProviderOperationFromSubjects(template, sourceReceiver, sourceArguments, context, options);
  if (fact === undefined) {
    return rejectSelectedOperation(expression, context, "RUST_SELECTED_OPERATION_ABI_INCOMPLETE", `Selected provider declaration '${providerIdentityText(identity)}' cannot finalize one total Rust operation ABI.`);
  }
  return acceptRustOperation(expression, fact, context, {
    sourceExpression: expression,
    providerDeclaration: identity,
  });
}

function finalizeProviderOperationFromSubjects(
  template: RustProviderOperationTemplate,
  sourceReceiver: ExtensionFactSubject | undefined,
  sourceArguments: readonly ExtensionFactSubject[],
  context: ExtensionObservationContext,
  options: RustOperationsProviderOptions,
): Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> | undefined {
  const sourceArgumentCarriers = sourceArguments.map((argument, index) => {
    const resolved = resolveRustTargetTypeRef(argument, context, options);
    return normalizeSelectedLiteralCarrier(argument, resolved, template.parameterCarriers?.[index], context, options);
  });
  if (sourceArgumentCarriers.some((carrier) => carrier === undefined)) {
    return undefined;
  }
  const sourceReceiverCarrier = sourceReceiver === undefined
    ? undefined
    : resolveRustTargetTypeRef(sourceReceiver, context, options);
  if (providerFormRequiresSourceReceiver(template.target) && sourceReceiverCarrier === undefined) {
    return undefined;
  }
  return finalizeProviderOperationFact(template, sourceArgumentCarriers as TargetTypeRef[], sourceReceiverCarrier);
}

function acceptRustOperation(
  subject: ExtensionFactSubject,
  fact: RustTargetOperationFact,
  context: ExtensionObservationContext,
  provenance: NonNullable<TargetOperationFact["provenance"]>,
  resultType: TargetTypeRef | undefined = rustTargetOperationResultCarrier(fact),
): ExtensionObservation<CheckedOperationMappingResult> {
  const evidence = [{ message: `rust selected operation ${fact.operationId}` }];
  context.facts.set(subject, rustTargetOperationFactKey, fact, evidence);
  return acceptObservation({
    operation: {
      operationId: fact.operationId,
      operationKind: genericOperationKind(fact),
      targetOperation: rustTargetOperationText(fact),
      ...(resultType === undefined ? {} : { resultType }),
      provenance,
    },
    ...(resultType === undefined ? {} : { resultType }),
    provenance,
  }, evidence);
}

function acceptDeclarationOperation(
  operationKind: TargetOperationFact["operationKind"],
): ExtensionObservation<CheckedOperationMappingResult> {
  return acceptObservation({
    operation: genericOperation(`tsonic.rust.declaration.${operationKind}`, operationKind, "declaration-only"),
  }, [{ message: "rust declaration-only checked operation" }]);
}

function rejectSelectedOperation<T>(
  nodeOrSpan: ExtensionFactSubject,
  context: ExtensionObservationContext,
  extensionCode: string,
  message: string,
): ExtensionObservation<T> {
  return rejectObservation({
    extensionId: context.extensionId,
    extensionCode,
    numericCode: 0,
    category: "error",
    message,
    nodeOrSpan,
    evidence: [{ message: "target.capability=rust.selected-operation" }],
  });
}

function providerOperationFact(row: RustProviderOperationRow): RustProviderOperationTemplate {
  return {
    kind: "provider-operation",
    operationId: providerOperationId(row),
    operationKind: row.operationKind,
    target: row.target,
    resultCarrier: row.resultCarrier,
    ...(row.parameterCarriers === undefined ? {} : { parameterCarriers: row.parameterCarriers }),
    ...(row.resultConversion === undefined ? {} : { resultConversion: row.resultConversion }),
    isAsync: row.isAsync === true,
    isFallible: row.isFallible === true,
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

function elementProvenance(request: CheckedElementAccessMappingRequest): NonNullable<TargetOperationFact["provenance"]> {
  return {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceResultType: request.sourceResultType,
  };
}

function sourceOperationId(
  context: ExtensionObservationContext,
  declaration: Node,
  kind: string,
): string {
  const ast = context.compiler.ast;
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return `tsonic.rust.source.${kind}:${fileName}:${ast.pos(declaration)}:${ast.end(declaration)}`;
}

function isDeclarationFileSubject(subject: ExtensionFactSubject, context: ExtensionObservationContext): boolean {
  const node = asNode(subject, context);
  return node !== undefined && context.compiler.ast.getFileName(context.compiler.ast.getSourceFile(node)).endsWith(".d.ts");
}

function selectedDeclarationIsCallable(
  subject: ExtensionFactSubject | undefined,
  context: ExtensionObservationContext,
): boolean {
  const declaration = asNode(subject, context);
  if (declaration === undefined) {
    return false;
  }
  const kind = context.compiler.ast.kindName(declaration);
  return kind === "KindMethodDeclaration" ||
    kind === "KindMethodSignature" ||
    kind === "KindCallSignature" ||
    kind === "KindConstructSignature" ||
    kind === "KindFunctionDeclaration";
}

function genericOperation(
  operationId: string,
  operationKind: TargetOperationFact["operationKind"],
  targetOperation: string,
): TargetOperationFact {
  return { operationId, operationKind, targetOperation };
}

function genericOperationKind(fact: RustTargetOperationFact): TargetOperationFact["operationKind"] {
  switch (fact.kind) {
    case "provider-operation":
      return fact.abi.operationKind;
    case "tuple-index":
    case "fixed-index":
      return "indexer";
    case "source-field":
    case "source-enum-member":
      return "property";
    case "for-of":
      return "iteration";
    default:
      return "operator";
  }
}

function rustTargetOperationText(fact: RustTargetOperationFact): string {
  if (fact.kind === "provider-operation") {
    const target = fact.abi.target;
    if (target.form === "call" || target.form === "path" || target.form === "free-call" || target.form === "call-str-slice" || target.form === "call-jsvalue-slice") {
      return target.path;
    }
    if (target.form === "index") {
      return "[]";
    }
    if (target.form === "marker") {
      return "marker";
    }
    if (target.form === "binary-operator") {
      return target.operator;
    }
    return target.name;
  }
  if (fact.kind === "operator-token") {
    return fact.operator;
  }
  return fact.operationId;
}

function providerIdentityText(identity: ProviderDeclarationIdentity): string {
  return [identity.providerId, identity.providerModuleId, identity.moduleSpecifier, identity.exportName, identity.memberName, identity.signatureId]
    .filter((part) => part !== undefined)
    .join("::");
}

function isCopyProvenCarrier(carrier: TargetTypeRef): boolean {
  return carrier.kind === "source-primitive";
}

function sourceLiteralIsRepresentableAsPrimitive(
  node: Node,
  primitive: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>["name"],
  context: ExtensionObservationContext,
): boolean {
  const selected = context.factResolver.resolve(node, targetOperationFactKey);
  return selectedSourceLiteralIsRepresentable(node, primitive, context.compiler.ast, selected);
}

function normalizeSelectedLiteralCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: ExtensionObservationContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const node = asNode(subject, context);
  if (node === undefined || expected === undefined) {
    return actual;
  }
  if (context.compiler.ast.kindName(node) === "KindStringLiteral") {
    const variant = options.sourceTypes.enumVariantForLiteral(expected, context.compiler.ast.text(node));
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
      context.facts.set(node, runtimeCarrierFactKey, { carrier: expected }, [
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
  context.facts.set(node, runtimeCarrierFactKey, { carrier: expected }, [
    { message: "rust selected numeric literal carrier from checked peer/target evidence" },
  ]);
  const selected = context.factResolver.resolve(node, targetOperationFactKey);
  if (selected?.operationId === rustPostCheckUnaryMinusOperationId) {
    context.facts.set(node, rustTargetOperationFactKey, {
      kind: "operator-token",
      operationId: rustPostCheckUnaryMinusOperationId,
      operator: "-",
      resultCarrier: expected,
    }, [{ message: "rust finalized selected unary-minus literal carrier" }]);
  } else if (selected?.operationId === rustPostCheckUnaryPlusOperationId) {
    context.facts.set(node, rustTargetOperationFactKey, {
      kind: "source-conversion",
      operationId: rustPostCheckUnaryPlusOperationId,
      resultCarrier: expected,
    }, [{ message: "rust finalized selected unary-plus literal carrier" }]);
  }
  return expected;
}

function normalizeSelectedArgumentCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: ExtensionObservationContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const literal = normalizeSelectedLiteralCarrier(subject, actual, expected, context, options);
  if (literal !== actual || expected?.kind !== "function-pointer") {
    return literal;
  }
  const node = asNode(subject, context);
  const kind = node === undefined ? "" : context.compiler.ast.kindName(node);
  return kind === "KindArrowFunction" || kind === "KindFunctionExpression"
    ? expected
    : actual;
}

function selectedArgumentCompatibility(
  subjects: readonly ExtensionFactSubject[],
  context: ExtensionObservationContext,
  options: RustOperationsProviderOptions,
): NonNullable<Parameters<typeof selectJsSurfaceOperation>[0]["argumentCompatibility"]> {
  return (expected, actual, index) => {
    const subject = subjects[index];
    const node = asNode(subject, context);
    if (node === undefined) {
      return undefined;
    }
    if (context.compiler.ast.kindName(node) === "KindStringLiteral" &&
      options.sourceTypes.enumVariantForLiteral(expected, context.compiler.ast.text(node)) !== undefined) {
      return 1;
    }
    const kind = context.compiler.ast.kindName(node);
    if (expected.kind === "function-pointer" &&
      (kind === "KindArrowFunction" || kind === "KindFunctionExpression")) {
      return 1;
    }
    if (actual === undefined) {
      return 10;
    }
    return expected.kind === "source-primitive" && isRustNumericCarrier(expected) &&
      sourceLiteralIsRepresentableAsPrimitive(node, expected.name, context)
      ? 1
      : undefined;
  };
}

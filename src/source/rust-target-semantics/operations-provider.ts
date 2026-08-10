import {
  flowStateFactKey,
} from "@tsonic/tsts";
import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  SourceCallMarkerKind,
} from "@tsonic/tsts";
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
  Node_Type,
  VariableDeclarationList_Declarations,
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
  rustUnitTargetType,
  rustVecTargetType,
} from "../rust-target-types.js";
import {
  isRustBoolCarrier,
  isRustCopyCarrier,
  getRustGeneratorProtocol,
  isRustIntegerCarrier,
  isRustJsArrayCarrier,
  isRustNullishSourceCarrier,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustOptionElementCarrier,
  isRustSignedNumericCarrier,
} from "../rust-target-types.js";
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
import { rustTargetOperationText } from "../rust-facts/target-operation.js";
import {
  finalizeJsCallbackOperation,
  selectJsSurfaceConstructorBySourceOwner,
  selectJsSurfaceOperation,
} from "./js-surface-operations.js";
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
import {
  tsonicCoreSourceSemanticsModules,
} from "@tsonic/source-core";
import {
  rustSourceSemanticsModules,
} from "../rust-source-semantics/source-modules.js";
import type { RustSourceTypeRegistry } from "./source-type-registry.js";
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
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
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
    operandNode !== undefined && context.ast.kindName(operandNode) === "KindNumericLiteral") {
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
  request: RustCheckedOperatorSelectionInput,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const selectedLeft = context.facts.getSelectedTargetOperator(request.left);
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
    ? ElementAccessExpression_ArgumentExpression(context.ast, leftNode)
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

export function selectRustCheckedCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const providerEvidence = resolveSelectedProviderDeclaration(
    context,
    request.sourceSelectedDeclaration,
    [
      { subject: request.sourceSelectedSignature, precision: "exact" },
      { subject: request.sourceCalleeDeclaration, precision: "declaration" },
      { subject: request.sourceCalleeSymbol, precision: "declaration" },
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
      target: { form: "call", path: "rt::JsError::error", argModes: ["ref"] },
      parameterCarriers: [rustStringTargetType()],
      resultCarrier,
      isAsync: false,
      isFallible: false,
    }, [rustStringTargetType()], context, options, {
      sourceName: "Error",
    });
  }
  if (selectedSourceMember !== undefined) {
    const receiverCarrier = resolveRustTargetTypeRef(
      request.sourceReceiver?.expression,
      context,
      options,
    );
    const generator = selectRustGeneratorSourceCall({
      ownerName: selectedSourceMember.ownerName,
      memberName: selectedSourceMember.memberName,
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
      selectedParameterCount: request.sourceSelectedSignatureParameters.length,
      argumentCarriers: request.arguments.map((argument) =>
        resolveRustTargetTypeRef(argument, context, options)),
    });
    if (generator.kind === "rejected") {
      return rejectSelectedOperation(
        request.call,
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
    const receiver = request.sourceReceiver?.expression;
    const receiverCarrier = resolveRustTargetTypeRef(receiver, context, options);
    const argumentCarriers = request.arguments.map((argument) =>
      resolveRustTargetTypeRef(argument, context, options));
    const selectedMethodTypeArgumentCarriers =
      (request.sourceSelectedMethodTypeArguments ?? []).map((argument) =>
        resolveRustTargetTypeRef(
          argument.explicitTypeNode ?? argument.selectedType,
          context,
          options,
        ));
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
      argumentCompatibility: selectedArgumentCompatibility(request.arguments, context, options),
    });
    if (selection === undefined || selection.fact.kind !== "provider-operation" || selection.resultCarrier === undefined) {
      return rejectSelectedOperation(request.call, context, "RUST_SELECTED_OPERATION_UNSUPPORTED", `The selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no closed Rust operation row for the selected receiver and argument carriers.`);
    }
    if (selection.callbackShape !== undefined) {
      return selection.fact.kind !== "provider-operation"
        ? rejectSelectedOperation(request.call, context, "RUST_SELECTED_CALLBACK_CARRIER_MISSING", `Selected JavaScript call '${selectedSourceMember.ownerName}.${selectedSourceMember.memberName}' has no provider operation template.`)
        : acceptRustPolicy({
            kind: "deferred-callback",
            callbackShape: selection.callbackShape,
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
  const calleeDeclaration = isProjectSourceDeclaration(context, request.sourceCalleeDeclaration)
    ? asNode(request.sourceCalleeDeclaration, context)
    : undefined;
  if (sourceDeclaration === undefined && calleeDeclaration !== undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_SELECTED_PROJECT_DECLARATION_MISSING", "Checked project-source call has callee evidence but no exact selected callable declaration evidence.");
  }
  if (sourceDeclaration !== undefined) {
    return acceptProjectSourceCall(request, sourceDeclaration, context, options);
  }

  return rejectSelectedOperation(
    request.call,
    context,
    "RUST_SELECTED_CALL_EVIDENCE_MISSING",
    "Checked call has no exact provider, source-profile, or project-source selection that Rust can lower.",
  );
}

export function finalizeRustDeferredCheckedCall(
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
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const arguments_ = request.arguments;
  if (arguments_.length !== deferred.parameterCarriers.length) {
    return rejectSelectedOperation(
      request.call,
      context,
      "RUST_SELECTED_CALLBACK_ARITY_MISMATCH",
      `Selected callback call '${deferred.sourceName}' has ${arguments_.length} source arguments but ${deferred.parameterCarriers.length} target parameters.`,
    );
  }
  const actual: (TargetTypeRef | undefined)[] = new Array(arguments_.length);
  if (deferred.callbackShape === "reduce") {
    const accumulatorArgument = arguments_[1];
    if (accumulatorArgument === undefined) {
      return rejectSelectedOperation(
        request.call,
        context,
        "RUST_SELECTED_CALLBACK_ACCUMULATOR_MISSING",
        "Selected reduce call has no exact accumulator source argument.",
      );
    }
    const accumulatorExpectation = deferred.parameterCarriers[1];
    const accumulator = resolveArgument(
      accumulatorArgument,
      accumulatorExpectation,
    );
    if (accumulator === undefined) {
      return rejectSelectedOperation(
        request.call,
        context,
        "RUST_SELECTED_CALLBACK_ACCUMULATOR_CARRIER_MISSING",
        "Selected reduce call has no closed target carrier for its exact accumulator argument.",
      );
    }
    actual[1] = accumulator;
    const callbackArgument = arguments_[0];
    const callbackTemplate = deferred.parameterCarriers[0];
    if (callbackArgument === undefined || callbackTemplate === undefined) {
      return rejectSelectedOperation(
        request.call,
        context,
        "RUST_SELECTED_CALLBACK_CARRIER_MISSING",
        "Selected reduce call has no exact callback argument or callback target template.",
      );
    }
    actual[0] = resolveArgument(
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
      request.call,
      context,
      "RUST_SELECTED_CALLBACK_CARRIER_MISSING",
      `Selected JavaScript call '${deferred.sourceName}' has no closed callback/result carrier from exact target analysis.`,
    );
  }
  const finalized = finalizeJsCallbackOperation({
    fact: deferred.template,
    parameterCarriers: deferred.parameterCarriers,
    callbackShape: deferred.callbackShape,
  }, actual as TargetTypeRef[]);
  if (finalized?.fact.kind !== "provider-operation") {
    return rejectSelectedOperation(
      request.call,
      context,
      "RUST_SELECTED_CALLBACK_CARRIER_CONFLICT",
      `Selected JavaScript call '${deferred.sourceName}' has callback argument carriers incompatible with its exact target operation row.`,
    );
  }
  return acceptSelectedCall(
    request,
    finalized.fact,
    finalized.parameterCarriers,
    context,
    options,
    { sourceName: deferred.sourceName },
  );
}

function replaceRustInferCarrier(
  template: TargetTypeRef,
  replacement: TargetTypeRef,
): TargetTypeRef {
  if (template.kind === "opaque" && template.id === "tsonic.rust.infer") {
    return replacement;
  }
  if (template.kind === "function-pointer") {
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
      request.call,
      context,
      "RUST_SOURCE_MARKER_UNSUPPORTED",
      `Rust does not support selected source marker '${markerName}' in this operation lane.`,
    );
  }
  const flow = context.facts.resolve(request.call, flowStateFactKey) ??
    context.facts.get(request.call, flowStateFactKey);
  const expectedState = markerName === "shared-borrow"
    ? "borrowed-shared"
    : markerName === "mutable-borrow" ? "borrowed-mut" : "moved";
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
      ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
      ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
      ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
      sourceArgumentBindings: request.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.sourceSelectedSignatureParameters,
    },
  }, evidence);
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
  const [patternNode, flagsNode] = request.arguments.map((argument) => asNode(argument, context));
  const ast = context.ast;
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
  context.facts.set(request.call, rustSelectedOperationKey, {
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
      ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
      ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
      ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
      sourceArgumentBindings: request.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.sourceSelectedSignatureParameters,
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
  if (ownerName === "String" && memberName === "match") {
    const [argument] = request.arguments;
    const creation = argument === undefined
      ? undefined
      : context.facts.resolve(argument, rustTargetOperationFactKey);
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
  const ast = context.ast;
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

function acceptProjectSourceCall(
  request: RustCheckedCallSelectionInput,
  selectedDeclaration: Node,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const { ast } = context;
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
    const sourceReturn = Node_Type(ast, callableDeclaration) ?? request.sourceReturnType;
    returnType = sourceReturn === undefined
      ? undefined
      : resolveRustTargetTypeRef(sourceReturn, context, options);
  }
  if (returnType === undefined) {
    return rejectSelectedOperation(request.call, context, "RUST_SOURCE_CALL_RETURN_CARRIER_MISSING", "The exact TSTS-selected project-source declaration has no closed Rust return carrier.");
  }
  const sourceName = construction
    ? "constructor"
    : rustProjectCallableTargetName(callableDeclaration, context) ?? "<anonymous>";
  const fileName = ast.getFileName(ast.getSourceFile(callableDeclaration));
  const member: RustTargetMember = {
    id: `tsonic.rust.source.call:${fileName}:${ast.pos(callableDeclaration)}:${ast.end(callableDeclaration)}`,
    sourceName,
    targetName: sourceName,
    kind: construction ? "constructor" : "method",
    parameters: parameters as NonNullable<RustTargetMember["parameters"]>,
    returnType,
  };
  const selectedSignature = {
    member,
    sourceDeclaration: callableDeclaration,
    ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
    ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
    ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
    ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
    sourceArgumentBindings: request.sourceArgumentBindings,
    sourceSelectedSignatureParameters: request.sourceSelectedSignatureParameters,
    ...(request.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.sourceSelectedMethodTypeArguments }),
    ...(targetTypeArguments === undefined ? {} : { targetTypeArguments }),
  };
  context.facts.set(request.call, rustSelectedCallKey, selectedSignature);
  return acceptRustPolicy({
    selectedSignature: {
      member,
      sourceDeclaration: callableDeclaration,
      ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
      ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
      ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
      ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
      sourceArgumentBindings: request.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.sourceSelectedSignatureParameters,
      ...(request.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.sourceSelectedMethodTypeArguments }),
      ...(targetTypeArguments === undefined ? {} : { targetTypeArguments }),
    },
  }, [{ message: `rust selected project-source call ${member.id}` }]);
}

function mapSelectedTargetTypeArguments(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
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
  const receiverSubject = selectedCallReceiverSubject(request, template.target);
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
  const operation: RustTargetOperationSelection = {
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
  for (const sourceArgument of fact.abi.sourceArguments) {
    if (sourceArgument.disposition !== "runtime") {
      continue;
    }
    const argument = request.arguments[sourceArgument.sourceIndex];
    if (argument === undefined) {
      return rejectSelectedOperation(
        request.call,
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
  context.facts.set(request.call, rustTargetOperationFactKey, {
    ...fact,
  }, evidence);
  context.facts.set(request.call, rustSelectedOperationKey, operation, evidence);
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
    returnType: resultCarrier,
    ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
  };
  const selectedSignature = {
      member,
      ...(request.sourceSelectedSignature === undefined ? {} : { sourceSignature: request.sourceSelectedSignature }),
      ...(request.sourceSelectedDeclaration === undefined ? {} : { sourceDeclaration: request.sourceSelectedDeclaration }),
      ...(request.sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol: request.sourceCalleeSymbol }),
      ...(request.sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration: request.sourceCalleeDeclaration }),
      ...(request.sourceReturnType === undefined ? {} : { sourceReturnType: request.sourceReturnType }),
      sourceArgumentBindings: request.sourceArgumentBindings,
      sourceSelectedSignatureParameters: request.sourceSelectedSignatureParameters,
      ...(request.sourceSelectedMethodTypeArguments === undefined ? {} : { sourceSelectedMethodTypeArguments: request.sourceSelectedMethodTypeArguments }),
      ...(targetTypeArguments === undefined ? {} : { targetTypeArguments: targetTypeArguments as TargetTypeRef[] }),
      ...(callIdentity.providerDeclaration === undefined ? {} : { providerDeclaration: callIdentity.providerDeclaration }),
    };
  context.facts.set(request.call, rustSelectedCallKey, selectedSignature, evidence);
  return acceptRustPolicy({ selectedSignature }, evidence);
}

type SelectedCallSourceCarriers =
  | { readonly kind: "resolved"; readonly carriers: readonly TargetTypeRef[] }
  | { readonly kind: "missing" }
  | { readonly kind: "incompatible"; readonly sourceIndex: number };

function selectedCallSourceCarriers(
  request: RustCheckedCallSelectionInput,
  fact: RustProviderOperationTemplate,
  declared: readonly (TargetTypeRef | undefined)[] | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): SelectedCallSourceCarriers {
  const compileTimeIndexes = new Set(fact.compileTimeSourceArgumentIndexes ?? []);
  const runtimeIndexes = request.arguments
    .map((_argument, index) => index)
    .filter((index) => !compileTimeIndexes.has(index));
  const declaredBySourceIndex = new Map<number, TargetTypeRef | undefined>();
  for (const sourceIndex of runtimeIndexes) {
    const bindings = request.sourceArgumentBindings.filter((binding) =>
      binding.sourceArgumentIndex === sourceIndex);
    const first = bindings[0];
    if (first === undefined || bindings.some((binding) =>
      binding.sourceParameterIndex !== first.sourceParameterIndex ||
      binding.sourceForm !== first.sourceForm) ||
      request.sourceSelectedSignatureParameters[first.sourceParameterIndex] === undefined) {
      return { kind: "missing" };
    }
    declaredBySourceIndex.set(sourceIndex, declared?.[first.sourceParameterIndex]);
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
  if (fact.target.form === "call-value-slice") {
    const form = fact.target;
    if (actual.length < form.leadingArguments.length) {
      return { kind: "incompatible", sourceIndex: actual.length };
    }
    const incompatible = actual.findIndex((carrier, sourceIndex) => {
      if (carrier === undefined) {
        return true;
      }
      const target = sourceIndex < form.leadingArguments.length
        ? form.leadingArguments[sourceIndex]!.carrier
        : form.elementCarrier;
      return !rustTargetTypeRefEquals(carrier, target) &&
        selectRustSourceValueConversion(carrier, target) === undefined;
    });
    return incompatible < 0
      ? { kind: "resolved", carriers: actual as TargetTypeRef[] }
      : { kind: "incompatible", sourceIndex: incompatible };
  }
  return { kind: "resolved", carriers: actual as TargetTypeRef[] };
}

function selectedCallReceiverSubject(
  request: RustCheckedCallSelectionInput,
  form: RustProviderOperationForm,
): ExtensionFactSubject | undefined {
  if (!providerFormRequiresSourceReceiver(form)) {
    return undefined;
  }
  return request.sourceReceiver?.expression;
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

function checkedCallIsConstruction(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
): boolean {
  const call = asNode(request.call, context);
  return call !== undefined && context.ast.kindName(call) === "KindNewExpression";
}

export function selectRustCheckedPropertyAccess(
  request: RustCheckedPropertySelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
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
      { subject: request.sourceSelectedSymbol, precision: "exact" },
    ],
  );
  if (providerEvidence.kind === "conflict") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_PROVIDER_EVIDENCE_CONFLICT", "Checked property access carries conflicting selected provider declaration identities.");
  }
  if (providerEvidence.kind === "selected") {
    return mapProviderCheckedOperation(request.expression, providerEvidence.identity, "property", context, options, request.receiver, []);
  }

  const sourceProfileMembers = resolveSelectedSourceProfilePropertyMembers(
    context,
    request.expression,
    request.sourceSelectedSymbol,
    request.sourceSelectedDeclaration,
    options.sourceProfiles,
  );
  if (sourceProfileMembers !== undefined) {
    const receiverCarrier = resolveRustTargetTypeRef(request.receiver, context, options);
    const generator = selectRustGeneratorSourceProperty({
      sourceMembers: sourceProfileMembers.members,
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
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
      );
      if (fact === undefined) {
        return rejectSelectedOperation(
          request.expression,
          context,
          "RUST_GENERATOR_SOURCE_PROPERTY_ABI_INCOMPLETE",
          "The exact selected iterator-result property cannot finalize one total Rust operation ABI.",
        );
      }
      return acceptRustOperation(request.expression, fact, context, {
        sourceExpression: request.expression,
        sourceReceiver: request.receiver,
        sourceSelectedSymbol: request.sourceSelectedSymbol,
        sourceSelectedDeclaration: request.sourceSelectedDeclaration,
        sourceResultType: request.sourceResultType,
      });
    }
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
    const resultCarrier = resolveRustTargetTypeRef(Node_Type(context.ast, declaration) ?? request.sourceResultType, context, options);
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

export function selectRustCheckedElementAccess(
  request: RustCheckedElementSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
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
      { subject: request.sourceSelectedSymbol, precision: "exact" },
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
  const lowering = selectRustIterationLowering(source, targetIteration);
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
    operationId: `tsonic.rust.iteration.${source.iterationKind}.${lowering.kind}`,
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
    (iterable?.kind === "pointer" && iterable.pointee.kind === "array") ||
    rustFixedArrayCarrierValue(iterable) !== undefined) {
    return { kind: "dense-index-keys" };
  }
  if (isRustJsArrayCarrier(iterable)) {
    return { kind: "sparse-index-keys" };
  }
  const keys = iterable === undefined
    ? undefined
    : options.sourceTypes.propertyKeysForCarrier(iterable, ast);
  return keys === undefined ? undefined : { kind: "static-keys", keys };
}

interface RustIterableTargetPolicy {
  readonly kind: "borrowed" | "sync-generator" | "async-generator";
  readonly elementCarrier: TargetTypeRef;
}

function rustIterableTargetPolicy(iterable: TargetTypeRef | undefined): RustIterableTargetPolicy | undefined {
  if (iterable?.kind === "array") {
    return { kind: "borrowed", elementCarrier: iterable.element };
  }
  if (iterable?.kind === "pointer" && iterable.pointee.kind === "array") {
    return { kind: "borrowed", elementCarrier: iterable.pointee.element };
  }
  const fixed = rustFixedArrayCarrierValue(iterable);
  if (fixed !== undefined) {
    return { kind: "borrowed", elementCarrier: fixed.element };
  }
  const jsElement = isRustJsArrayCarrier(iterable) ? iterable?.typeArguments?.[0] : undefined;
  if (jsElement !== undefined) {
    return { kind: "borrowed", elementCarrier: jsElement };
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
    return target.kind === "borrowed"
      ? { kind: "borrowed", style: isRustCopyCarrier(target.elementCarrier) ? "copied" : "cloned" }
      : { kind: "owned" };
  }
  if (source.mechanism.kind === "asynchronous-iterator-protocol") {
    return target.kind === "async-generator" ? { kind: "async-generator" } : undefined;
  }
  if (target.kind === "async-generator") {
    return undefined;
  }
  return target.kind === "borrowed"
    ? { kind: "borrowed", style: isRustCopyCarrier(target.elementCarrier) ? "copied" : "cloned" }
    : { kind: "owned" };
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
      targetTypeContainsSelectedParameter(targetCarrier, selectedTypeParameterNames)) {
      return acceptRustPolicy({}, [
        { message: "rust deferred the selected generic source-call argument carrier to post-check target substitution" },
      ]);
    }
    const sourceCarrier = resolveRustTargetTypeRef(request.expression, context, options);
    if (sourceCarrier !== undefined && rustTargetTypeRefEquals(sourceCarrier, targetCarrier)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument already has the selected target parameter carrier" },
      ]);
    }
    const sourceNode = asNode(request.expression, context);
    const sourceKind = sourceNode === undefined ? "" : context.ast.kindName(sourceNode);
    if (targetCarrier.kind === "function-pointer" &&
      (sourceKind === "KindArrowFunction" || sourceKind === "KindFunctionExpression")) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected function expression uses the selected target function-pointer carrier" },
      ]);
    }
    if (targetCarrier.kind === "source-primitive" && sourceNode !== undefined &&
      sourceLiteralIsRepresentableAsPrimitive(sourceNode, targetCarrier.name, context)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected literal is representable by the selected target primitive carrier" },
      ]);
    }
    if (targetCarrier.kind === "pointer" && sourceCarrier !== undefined &&
      rustTargetTypeRefEquals(targetCarrier.pointee, sourceCarrier)) {
      return acceptRustPolicy({ convertedType: targetCarrier }, [
        { message: "rust selected call argument borrows into the selected target pointer carrier" },
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
  const operation: RustTargetOperationSelection = {
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
  context.facts.set(request.expression, rustSelectedOperationKey, operation, evidence);
  return acceptRustPolicy({ convertedType: targetCarrier, operation }, evidence);
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
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
  sourceReceiver: ExtensionFactSubject | undefined,
  sourceArguments: readonly ExtensionFactSubject[],
): RustPolicySelection<RustCheckedOperationSelectionResult> {
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
  context: RustOperationPolicyContext,
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
): RustPolicySelection<T> {
  return rejectRustPolicy({
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
    kind === "KindFunctionDeclaration";
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
      return "indexer";
    case "source-field":
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

function normalizeSelectedArgumentCarrier(
  subject: ExtensionFactSubject | undefined,
  actual: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const literal = normalizeSelectedLiteralCarrier(subject, actual, expected, context, options);
  if (literal !== actual || expected?.kind !== "function-pointer") {
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

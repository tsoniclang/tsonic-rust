import {
  isRustBigIntCarrier,
  isRustBoolCarrier,
  isRustProgramErrorCarrier,
  isRustNumericCarrier,
  rustOptionElementCarrier,
  isRustSignedNumericCarrier,
} from "../../../policy/types/target-types.js";
import {
  rustTargetOperationFactKey,
  rustPostCheckBinaryOperationId,
  rustPostCheckUnaryMinusOperationId,
  rustPostCheckUnaryPlusOperationId,
} from "../../facts/keys.js";
import { acceptDeclarationOperation, acceptRustOperation, isDeclarationFileSubject, normalizeSelectedLiteralCarrier, normalizeSelectedOperationInputCarrier, providerIdentityText, providerOperationTemplate, rejectSelectedOperation, selectedArgumentMatchScore } from "./result.js";
import { acceptRustPolicy } from "../../../policy/operations/contracts.js";
import { asNode, resolveSelectedJsSourceMember, resolveSelectedProviderDeclaration } from "../../../policy/evidence/selected-source.js";
import {
  ElementAccessExpression_ArgumentExpression,
  KindBigIntLiteral,
} from "@tsonic/target-api/source";
import { finalizeRustProviderOperationAbi } from "../../facts/finalized-operation-abi.js";
import { instantiateProviderOperationTemplate, providerFormRequiresSourceReceiver } from "./calls/instantiation.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { rustEffectiveValueCarrier } from "../../facts/value-carrier-queries.js";
import { rustSourcePrimitiveTargetType, rustUnitTargetType } from "../../../policy/types/target-types.js";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import { selectJsSurfaceOperation } from "../../../policy/operations/js-surface.js";
import { selectRustProviderOperation } from "../../../policy/operations/provider-selection.js";
import type {
  RustCheckedCallSelectionInput,
  RustCheckedOperationSelectionResult,
  RustCheckedOperatorSelectionInput,
  RustOperationPolicyContext,
  RustPolicySelection,
  RustTargetOperationSelection,
} from "../../../policy/operations/contracts.js";
import type { ExtensionFactSubject, Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";
import type { RustOperatorToken, RustRuntimeSetOperationKind, RustTargetOperationFact } from "../../facts/keys.js";
import type { TargetTypeRef } from "../../../policy/types/model.js";

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
    argumentMatchScore: selectedArgumentMatchScore(assignmentSubjects, context, options),
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
    ...(template.errorCarrier === undefined ? {} : { errorCarrier: template.errorCarrier }),
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

export function selectedCallArgumentNodes(
  request: RustCheckedCallSelectionInput,
): readonly Node[] {
  return request.source.sourceArguments.map((argument) => argument.expression);
}

export function selectedCallArgumentCarriers(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly (TargetTypeRef | undefined)[] {
  return request.source.sourceArguments.map((argument) =>
    selectedSourceValueCarrier(argument, context, options));
}

export function selectedSourceValueCarrier(
  value: RustCheckedCallSelectionInput["source"]["sourceArguments"][number],
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  return selectedValueCarrier(value.expression, value.type, context, options);
}

export function selectedValueCarrier(
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

export function selectedCallCalleeSymbol(
  request: RustCheckedCallSelectionInput,
): import("@tsonic/tsts").Symbol | undefined {
  return request.source.sourceCallee.selectedSymbol ??
    request.source.sourceCallee.symbol;
}

export function selectedCallCalleeDeclaration(
  request: RustCheckedCallSelectionInput,
): Node | undefined {
  return request.source.sourceCallee.selectedDeclaration ??
    request.source.sourceCallee.declaration;
}

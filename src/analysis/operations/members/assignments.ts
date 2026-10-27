import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { isRustAbsenceCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";

import { normalizeSelectedOperationInputCarrier, providerIdentityText, rejectSelectedOperation, selectedArgumentMatchScore } from "./result.js";
import { providerOperationTemplate } from "../../../policy/operations/members/provider-templates.js";
import { acceptRustOperation } from "../../program/records/operations/selected-operation-values.js";
import { normalizeSelectedLiteralCarrier } from "../../source-evidence/types/resolution/selected-literals.js";

import { asNode, resolveSelectedJsSourceMember, resolveSelectedProviderDeclaration } from "../../../policy/identities/selected-source.js";
import { selectRustSourceProfileIndexMembers } from "./selected-members.js";
import { selectJsSurfaceMemberWrite } from "../../../policy/operations/source-profiles/js/member-reads.js";
import { ElementAccessExpression_ArgumentExpression } from "@tsonic/target-api/source";
import { finalizeRustProviderOperationAbi } from "../../../policy/operations/members/abi/finalize.js";
import { providerFormRequiresSourceReceiver } from "../../../policy/operations/members/call-inputs.js";
import { instantiateProviderOperationTemplate } from "../../../policy/types/callables/provider-templates.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { resolveRustExactNullishValueCarrier } from "../../source-evidence/types/resolution/target.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";
import { recordRustValueCarrierReconciliation } from "../../program/records/types/value-carrier-admission.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

import { selectRustExactIntegerConversion } from "../../../policy/conversions/exact-integer.js";

import { selectRustProviderOperation } from "../../../policy/operations/provider-selection.js";

import type { RustCheckedOperationSelectionResult, RustCheckedOperatorSelectionInput, RustPolicySelection } from "../../../policy/model/contracts.js";
import type { ExtensionFactSubject, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { RustOperationsProviderOptions } from "./model.js";

import type { RustRuntimeSetOperationKind } from "../../../target-model/operations/model.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetOperationSupportsAssignment } from "../../../policy/operations/members/native-contracts.js";

import { selectRustProviderSourceReceiver } from "./source-qualifiers.js";
import type { RustProviderSourceReceiver } from "../../../target-model/records/operations/finalized-operation.js";
import { assignmentTarget } from "../operator-inputs.js";

type RustMemberWriteInput = Pick<RustCheckedOperatorSelectionInput, "expression" | "left" | "right">;

export function mapSelectedAssignment(
  request: RustMemberWriteInput,
  left: TargetTypeRef | undefined,
  right: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const target = request.left === undefined ? undefined : assignmentTarget(context.ast, request.left);
  request = { ...request, left: target };
  const selectedLeftFact = context.records.targetOperation.get(request.left);
  if (selectedLeftFact?.kind === "builtin-error-property" && rustTargetOperationSupportsAssignment(selectedLeftFact, context.typeDefinitions)) return undefined;
  if (selectedLeftFact?.kind === "source-field" ||
    selectedLeftFact?.kind === "source-static-field" ||
    selectedLeftFact?.kind === "source-union-field" ||
    selectedLeftFact?.kind === "source-accessor" ||
    selectedLeftFact?.kind === "provider-operation" && selectedLeftFact.abi.target.form === "index") {
    return undefined;
  }
  const selectedLeft = context.records.selectedOperation.get(request.left);
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
  const operationKind = selectedLeft?.operationKind === "property"
    ? "property-set"
    : selectedLeft?.operationKind === "indexer"
      ? "index-set"
      : undefined;
  if (operationKind === undefined) return undefined;
  const leftNode = asNode(request.left, context);
  const indexed = leftNode === undefined ? undefined : context.semanticsFor(leftNode).operations.elementAccess(leftNode);
  const indexMembers = indexed === undefined || leftNode === undefined ? undefined : selectRustSourceProfileIndexMembers({
    expression: leftNode, receiver: indexed.receiver.expression, sourceReceiverType: indexed.receiver.type,
    sourceArgumentType: indexed.argument.type,
  }, context, options);
  const directIdentity = resolveSelectedJsSourceMember(context, selectedDeclaration, options.sourceProfiles);
  const jsMembers = operationKind === "index-set"
    ? indexMembers?.profile === "js" ? indexMembers.members : undefined
    : directIdentity === undefined ? undefined : [directIdentity];
  const jsIdentity = jsMembers?.[0];
  const receiver = selectedLeft?.provenance?.sourceReceiver;
  const receiverCarrier = rustEffectiveValueCarrier(context.records, receiver) ??
    resolveRustTargetTypeRef(receiver, context, options);
  const sourceReceiver = receiver === undefined ? undefined
    : selectRustProviderSourceReceiver(receiver, receiverCarrier, context, options);
  if (receiver !== undefined && sourceReceiver === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_RECEIVER_CARRIER_MISSING",
      "Selected setter has no closed Rust receiver evaluation.");
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
      sourceReceiver,
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
  const indexNode = operationKind === "index-set" && leftNode !== undefined
    ? ElementAccessExpression_ArgumentExpression(context.ast, leftNode)
    : undefined;
  const propertyNameNode = operationKind === "property-set" && leftNode !== undefined
    ? context.ast.name(leftNode)
    : undefined;
  const authoredPropertyKey = propertyNameNode === undefined
    ? undefined
    : context.ast.text(propertyNameNode);
  const assignmentSubjects = operationKind === "index-set"
    ? indexNode === undefined ? undefined : [indexNode, request.right]
    : [request.right];
  if (assignmentSubjects === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_EVIDENCE_MISSING", "Selected JavaScript assignment has no closed index/value source evidence.");
  }
  const selection = selectJsSurfaceMemberWrite(jsMembers!, {
    operationKind,
    receiverCarrier,
    argumentCarriers: assignmentSubjects.map((subject) =>
      subject === undefined ? right : resolveRustTargetTypeRef(subject, context, options)),
    ...(request.right === undefined ? {} : {
      argumentMatchScore: selectedArgumentMatchScore(assignmentSubjects.filter(
        (subject): subject is import("@tsonic/tsts").Node => subject !== undefined,
      ), context, options),
    }),
    ...(jsIdentity.memberName === "index" && authoredPropertyKey !== undefined
      ? { authoredPropertyKey }
      : {}),
  }, indexMembers?.readonly === true, context.typeDefinitions);
  if (selection === undefined || selection.fact.kind !== "runtime-set") {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_UNSUPPORTED", `The selected JavaScript assignment '${jsIdentity.ownerName}.${jsIdentity.memberName}' has no closed Rust setter operation.`);
  }
  const valueIndex = operationKind === "index-set" ? 1 : 0;
  const valueCarrier = selection.parameterCarriers?.[valueIndex];
  const selectedRight = request.right === undefined ? right
    : normalizeSelectedOperationInputCarrier(request.right, right, valueCarrier, context, options);
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
    ...(sourceReceiver === undefined ? {} : { sourceReceiver }),
    sourceArgumentCarriers,
    declaredSourceArgumentCarriers: selection.parameterCarriers,
    resultCarrier: rustUnitTargetType(),
    isAsync: false,
    isFallible: selection.fact.fallible === true,
    ...(selection.fact.fallible === true ? { errorBoundary: "source-program" as const } : {}),
  }, context.typeDefinitions);
  if (abi === undefined) {
    return rejectSelectedOperation(request.expression, context, "RUST_SELECTED_ASSIGNMENT_ABI_INCOMPLETE", "The selected JavaScript setter cannot finalize one total Rust operation ABI.");
  }
  return acceptRustOperation({
    kind: "runtime-set",
    operationId: selection.fact.operationId,
    abi,
  }, {
    sourceExpression: request.expression,
    sourceReceiver: receiver,
    sourceSelectedDeclaration: selectedDeclaration,
    sourceResultType: request.right,
  }, context.records.runtimeCarrier.get(request.right)?.carrier ?? right ?? left);
}

function mapSelectedProviderAssignment(
  request: RustMemberWriteInput,
  right: TargetTypeRef | undefined,
  identity: ProviderDeclarationIdentity,
  operationKind: RustRuntimeSetOperationKind,
  receiver: ExtensionFactSubject | undefined,
  selectedDeclaration: ExtensionFactSubject | undefined,
  receiverCarrier: TargetTypeRef | undefined,
  sourceReceiver: RustProviderSourceReceiver | undefined,
  context: RustOperationAnalysisContext,
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
    ? indexNode === undefined ? undefined : [indexNode, request.right]
    : [request.right];
  if (sourceArguments === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROVIDER_SET_EVIDENCE_MISSING",
      "Selected provider setter has no exact source index/value evidence.",
    );
  }
  const rawArgumentCarriers = sourceArguments.map((argument) =>
    argument === undefined ? right : resolveRustTargetTypeRef(argument, context, options));
  const instantiation = instantiateProviderOperationTemplate(
    providerOperationTemplate(selection.row, operationKind),
    {
      ...(receiverCarrier === undefined ? {} : { sourceReceiverCarrier: receiverCarrier }),
      sourceParameterCarriers: rawArgumentCarriers,
    }, context.typeDefinitions,
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
  const sourceArgumentCarriers = sourceArguments.map((argument, index) => {
    const actual = rawArgumentCarriers[index];
    const expected = template.parameterCarriers?.[index];
    const selected = argument === undefined ? actual : normalizeSelectedOperationInputCarrier(
      argument,
      actual,
      expected,
      context,
      options,
    );
    if (rustTargetTypeRefEquals(selected, expected)) return selected;
    const conversion = argument === undefined || operationKind !== "property-set" || template.target.form !== "field" ||
      actual === undefined || expected === undefined ? undefined
      : selectRustExactIntegerConversion(actual, rustOptionElementCarrier(actual) === undefined
        ? rustOptionElementCarrier(expected) ?? expected : expected);
    if (conversion === undefined || argument === undefined) return selected;
    recordRustValueCarrierReconciliation(context.records, context.requiredRecords, argument, { kind: "conversion",
      fact: { sourceCarrier: conversion.source, targetCarrier: conversion.target, conversion } });
    return expected;
  });
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
      [{ message: `actual=${JSON.stringify(rawArgumentCarriers)}; expected=${JSON.stringify(template.parameterCarriers)}` }],
    );
  }
  const abi = finalizeRustProviderOperationAbi({
    operationKind,
    form: template.target,
    ...(sourceReceiver === undefined ? {} : { sourceReceiver: sourceReceiver.kind === "runtime"
      ? { ...sourceReceiver, ...(template.receiverCarrier === undefined ? {} : { declaredCarrier: template.receiverCarrier }) }
      : sourceReceiver }),
    sourceArgumentCarriers: finalizedSourceArgumentCarriers,
    declaredSourceArgumentCarriers: template.parameterCarriers,
    resultCarrier: template.resultCarrier,
    isAsync: template.isAsync,
    isFallible: template.isFallible,
    ...(template.evaluation === undefined ? {} : { evaluation: template.evaluation }),
    ...(template.errorBoundary === "none" ? {} : { errorBoundary: template.errorBoundary }),
    ...(template.errorCarrier === undefined ? {} : { errorCarrier: template.errorCarrier }),
    isUnsafe: template.isUnsafe,
  }, context.typeDefinitions);
  if (abi === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_PROVIDER_SET_ABI_INCOMPLETE",
      `Selected provider declaration '${providerIdentityText(identity)}' cannot finalize one total Rust ${operationKind} ABI.`,
    );
  }
  const selectedRight = finalizedSourceArgumentCarriers[finalizedSourceArgumentCarriers.length - 1];
  let sourceResultCarrier = context.records.runtimeCarrier.get(request.right)?.carrier ?? right;
  const rightNode = asNode(request.right, context);
  if (rightNode !== undefined && context.ast.kindName(rightNode) === "KindArrayLiteralExpression") {
    sourceResultCarrier = rustOptionElementCarrier(selectedRight) ?? selectedRight;
  }
  if (isRustAbsenceCarrier(sourceResultCarrier)) {
    const sourceNode = asNode(request.right, context);
    const sourceType = sourceNode === undefined ? undefined : context.currentSemantics.types.expressionType(sourceNode);
    sourceResultCarrier = sourceType === undefined ? undefined
      : resolveRustExactNullishValueCarrier(sourceType, context.currentSemantics);
  }
  return acceptRustOperation({
    kind: "runtime-set",
    operationId: template.operationId,
    abi,
  }, {
    sourceExpression: request.expression,
    sourceReceiver: receiver,
    sourceSelectedDeclaration: selectedDeclaration,
    sourceResultType: request.right,
    providerDeclaration: identity,
  }, sourceResultCarrier ?? selectedRight);
}

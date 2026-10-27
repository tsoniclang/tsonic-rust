import { requireRustRecord } from "../program/records/objects/required-records.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { isRustJsArrayCarrier, rustStringTargetType } from "../../target-model/types/index.js";
import { acceptRustPolicy } from "../../policy/model/contracts.js";

import { selectRustOptionalCallResult } from "./members/calls/optional-results.js";
import { asNode } from "../../policy/identities/selected-source.js";
import { rustOptionElementCarrier } from "../../target-model/types/index.js";

import { rejectSelectedOperation } from "./members/result.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import { selectedCallCalleeSymbol, selectedSourceValueCarrier } from "./members/operators.js";
import { selectedValueCarrier } from "./selected-values.js";
import { selectedRustCallSignature } from "../program/records/calls/selected-call.js";
import { selectedAuthoredObjectFields } from "./members/object-shape-fields.js";
import { selectObjectAssignmentFields, selectObjectShapeProjectionFields } from "../../policy/operations/source-profiles/js/object-fields.js";
import type { SelectedObjectShapeProjection } from "../../policy/operations/source-profiles/js/object-fields.js";
import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustPolicySelection, RustTargetOperationSelection } from "../../policy/model/contracts.js";

import type { RustOperationsProviderOptions } from "./members/model.js";
import type { RustTargetMember } from "../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";

import { selectRustRecordObjectCall } from "./members/records.js";

import { selectedObjectShapeProjection } from "../../policy/operations/source-profiles/js/object-fields.js";
export function mapSelectedJsSpecialCall(
  request: RustCheckedCallSelectionInput,
  ownerName: string,
  memberName: string,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const objectProjection = selectedObjectShapeProjection(
    ownerName,
    memberName,
  );
  if (objectProjection !== undefined) {
    const record = selectRustRecordObjectCall(request, objectProjection, context, options);
    if (record !== undefined) return record;
    const sourceArgument = request.source.sourceArguments[0];
    if (objectProjection.projection === "keys" && sourceArgument !== undefined &&
      isRustJsArrayCarrier(selectedValueCarrier(sourceArgument.expression, sourceArgument.type, context, options))) {
      return undefined;
    }
    return mapSelectedObjectShapeProjection(
      request,
      objectProjection,
      context,
      options,
    );
  }
  return undefined;
}

function mapSelectedObjectShapeProjection(
  request: RustCheckedCallSelectionInput,
  selection: SelectedObjectShapeProjection,
  context: RustOperationAnalysisContext,
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
  const shape = options.sourceTypes.structuralObjectForType(
    sourceValue.type,
    sourceValueCarrier,
  );
  if (sourceValueNode === undefined || sourceValueCarrier === undefined || shape === undefined ||
    shape.storage !== "structural-object" ||
    !rustTargetTypeRefEquals(sourceValueCarrier, shape.carrier)) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_SHAPE_PROJECTION_NOT_CLOSED",
      `Selected Object.${selection.sourceName} call requires one exact generated structural object carrier.`,
    );
  }
  const assignmentSource = selection.assignmentSourceArgumentIndex === undefined
    ? undefined
    : sourceArguments[selection.assignmentSourceArgumentIndex];
  const assignmentSourceNode = assignmentSource === undefined
    ? undefined
    : asNode(assignmentSource.expression, context);
  const assignmentSourceCarrier = assignmentSource === undefined
    ? undefined
    : selectedValueCarrier(
        assignmentSource.expression,
        assignmentSource.type,
        context,
        options,
      );
  const assignmentShape = assignmentSource === undefined ||
      assignmentSourceCarrier === undefined
    ? undefined
    : options.sourceTypes.structuralObjectForType(
        assignmentSource.type,
        assignmentSourceCarrier,
      );
  if (selection.projection === "assign" && (
    assignmentSourceNode === undefined || assignmentSourceCarrier === undefined ||
    assignmentShape === undefined || assignmentShape.storage !== "structural-object" ||
    !rustTargetTypeRefEquals(assignmentShape.carrier, assignmentSourceCarrier)
  )) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_ASSIGN_SOURCE_NOT_CLOSED",
      "Selected Object.assign requires exact generated target and source structural object carriers.",
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
  const orderedAssignmentFields = assignmentShape === undefined
    ? undefined
    : selectedAuthoredObjectFields(assignmentShape, context);
  if (selection.projection === "assign" &&
    (orderedAssignmentFields === undefined || orderedAssignmentFields.kind === "rejected")) {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_ASSIGN_SOURCE_NOT_CLOSED",
      orderedAssignmentFields?.kind === "rejected"
        ? orderedAssignmentFields.reason
        : "Selected Object.assign source has no exact enumerable own-property order.",
    );
  }
  const resolvedSourceResult = resolveRustTargetTypeRef(
    request.source.sourceResultType,
    context,
    options,
  );
  const innerResultCarrier = selection.projection === "assign"
    ? sourceValueCarrier
    : request.source.optionalChain
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
  const assignmentFields = selection.projection === "assign"
    ? selectObjectAssignmentFields(
        orderedFields.fields,
        orderedAssignmentFields?.kind === "resolved"
          ? orderedAssignmentFields.fields
          : [],
        context.typeDefinitions,
      )
    : undefined;
  if (assignmentFields?.kind === "rejected") {
    return rejectSelectedOperation(
      request.source.call,
      context,
      "RUST_OBJECT_ASSIGN_RESULT_INVALID",
      assignmentFields.reason,
    );
  }
  const projectedFields = selection.projection === "assign"
    ? { kind: "resolved" as const, fields: [] }
    : selectObjectShapeProjectionFields(
        selection.projection,
        orderedFields.fields,
        innerResultCarrier,
        context.typeDefinitions,
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
  if (optionalResult.kind === "rejected" ||
    selection.projection !== "assign" && (
      resolvedSourceResult === undefined ||
      !rustTargetTypeRefEquals(optionalResult.resultCarrier, resolvedSourceResult)
    )) {
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
    ...(assignmentSourceNode === undefined ? {} : { assignmentSource: assignmentSourceNode }),
    ...(assignmentSourceCarrier === undefined
      ? {}
      : { assignmentSourceCarrier }),
    ...(assignmentFields?.kind !== "resolved"
      ? {}
      : { assignmentFields: assignmentFields.fields }),
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
    selection.static && (index === 0 || selection.projection === "assign" && index === 1)
      ? "borrow-shared" as const
      : "by-value" as const);
  for (const [index, argument] of sourceArguments.entries()) {
    const mode = parameterModes[index]!;
    requireRustRecord(context.requiredRecords, "argumentPassing", argument.expression, mode, "analysis/operations/members/object-shapes.ts");
    context.records.argumentPassingPlans.pass(argument.expression, mode);
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
  const selectedSignature = selectedRustCallSignature(request, member,
    selection.static ? undefined : { sourceSelectedReceiverCarrier: sourceValueCarrier });
  if (optionalResult.fact !== undefined) {
    requireRustRecord(context.requiredRecords, "optionalChain", request.source.call, optionalResult.fact.operationKind, "analysis/operations/members/object-shapes.ts");
    context.records.optionalChains.guard(request.source.call, optionalResult.fact.guard,
      optionalResult.fact.operationKind, optionalResult.fact);
  }
  return acceptRustPolicy({ selectedSignature, targetFact: fact, operation }, evidence);
}

import {
  type RustSelectedSourceMemberSet,
} from "../../../policy/evidence/selected-source.js";
import { selectRustErrorTypePredicate } from "../../../policy/operations/source-profiles/js/type-tests.js";
import {
  rustJsErrorTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetTypeRef } from "../../../policy/types/resolution.js";
import { rustEffectiveValueCarrier } from "../../facts/value-carrier-queries.js";
import { acceptRustMemberOperation, acceptRustOperation, rejectSelectedOperation } from "./result.js";
import type {
  RustCheckedOperationSelectionResult,
  RustCheckedOperatorSelectionInput,
  RustCheckedPropertySelectionInput,
  RustOperationPolicyContext,
  RustPolicySelection,
} from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier } from "../../../target-model/types/carriers/source-error.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { selectRustClosedTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";

export function selectRustBuiltinErrorTypeTest(
  request: RustCheckedOperatorSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const predicate = selectRustErrorTypePredicate(context, request.sourceRightDeclaration, options.sourceProfiles);
  if (predicate === undefined) return undefined;
  const sourceCarrier = rustEffectiveValueCarrier(context.facts, request.left) ??
    resolveRustTargetTypeRef(request.left, context, options);
  const test = sourceCarrier === undefined ? undefined : selectRustClosedTypeTestPlan(sourceCarrier, predicate, options.projectTypes, context.typeDefinitions);
  if (sourceCarrier === undefined || test === undefined) {
    return rejectSelectedOperation(
      request.expression, context, "RUST_BUILTIN_ERROR_TYPE_TEST_CARRIER",
      "A builtin Error test requires an exact closed native Error predicate plan.",
    );
  }
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  return acceptRustOperation(request.expression, {
    kind: "closed-type-test",
    operationId: `tsonic.rust.closed-type-test.${closedMetadataKey(predicate)}`,
    sourceCarrier,
    resultCarrier,
    predicate,
    test,
  }, context, {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    sourceSelectedDeclaration: request.sourceRightDeclaration,
  }, resultCarrier);
}

export function selectRustBuiltinErrorProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  sourceMembers: RustSelectedSourceMemberSet | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const member = sourceMembers?.members[0];
  if (member === undefined || !sourceMembers?.members.every((candidate) =>
    candidate.ownerName === "Error" && candidate.memberName === member.memberName) ||
    (!rustTargetTypeRefEquals(receiverCarrier, rustJsErrorTargetType()) && !isRustMutableJsErrorCarrier(receiverCarrier) && !isRustSourceErrorCarrier(receiverCarrier))) {
    return undefined;
  }
  if (request.accessMode === "delete") return rejectSelectedOperation(request.expression, context,
    "RUST_BUILTIN_ERROR_DELETE_UNSUPPORTED", "An admitted native Error field cannot be removed from its physical storage.");
  if (request.accessMode !== "read" && !isRustMutableJsErrorCarrier(receiverCarrier) && !isRustWritableSourceErrorCarrier(receiverCarrier)) {
    return rejectSelectedOperation(
      request.expression, context, "RUST_BUILTIN_ERROR_MUTATION_UNSUPPORTED",
      "The exact selected native Error storage is immutable; writable Error admission requires an original physical setter owner.",
    );
  }
  if (member.memberName !== "message" && member.memberName !== "name" && member.memberName !== "stack") {
    return rejectSelectedOperation(
      request.expression, context, "RUST_BUILTIN_ERROR_PROPERTY_UNSUPPORTED",
      "The selected builtin Error member has no exact native runtime property contract.",
    );
  }
  return acceptRustMemberOperation(request, "property", {
    kind: "builtin-error-property",
    accessMode: request.accessMode,
    operationId: `tsonic.rust.error.property.${member.memberName}`,
    receiverCarrier: receiverCarrier!,
    resultCarrier: member.memberName === "stack"
      ? rustOptionTargetType(rustStringTargetType())
      : rustStringTargetType(),
    property: member.memberName,
  }, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceResultType: request.sourceResultType,
  });
}

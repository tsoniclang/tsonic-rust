import { selectRustBuiltinErrorPropertyForm } from "../../../policy/operations/source-profiles/js/error-properties.js";
import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { type RustSelectedSourceMemberSet } from "../../../policy/identities/selected-source.js";
import { selectRustErrorTypePredicate } from "../source-profiles/js/type-tests.js";
import { rustSourcePrimitiveTargetType } from "../../../target-model/types/index.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";
import { acceptRustMemberOperation, rejectSelectedOperation } from "./result.js";
import { acceptRustOperation } from "../../program/records/operations/selected-operation-values.js";
import type { RustCheckedOperationSelectionResult, RustCheckedOperatorSelectionInput, RustCheckedPropertySelectionInput, RustPolicySelection } from "../../../policy/model/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCarrierProvidesErrorObservation } from "../../../policy/constraints/error-protocols.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { selectRustClosedTypeTestPlan } from "../../../policy/operations/operators/type-tests.js";

export function selectRustBuiltinErrorTypeTest(
  request: RustCheckedOperatorSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const predicate = selectRustErrorTypePredicate(context, request.sourceRightDeclaration, options.sourceProfiles);
  if (predicate === undefined) return undefined;
  const sourceCarrier = rustEffectiveValueCarrier(context.records, request.left) ??
    resolveRustTargetTypeRef(request.left, context, options);
  const test = sourceCarrier === undefined ? undefined : selectRustClosedTypeTestPlan(sourceCarrier, predicate, options.projectTypes, context.typeDefinitions);
  if (sourceCarrier === undefined || test === undefined) {
    return rejectSelectedOperation(
      request.expression, context, "RUST_BUILTIN_ERROR_TYPE_TEST_CARRIER",
      "A builtin Error test requires an exact closed native Error predicate plan.",
    );
  }
  const resultCarrier = rustSourcePrimitiveTargetType("bool");
  return acceptRustOperation({
    kind: "closed-type-test",
    operationId: `tsonic.rust.closed-type-test.${closedMetadataKey(predicate)}`,
    sourceCarrier,
    resultCarrier,
    predicate,
    test,
  }, {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    sourceSelectedDeclaration: request.sourceRightDeclaration,
  }, resultCarrier);
}

export function selectRustBuiltinErrorProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  sourceMembers: RustSelectedSourceMemberSet | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const member = sourceMembers?.members[0];
  if (member === undefined || !sourceMembers?.members.every((candidate) =>
    candidate.ownerName === "Error" && candidate.memberName === member.memberName) ||
    !rustCarrierProvidesErrorObservation(receiverCarrier, context.typeDefinitions)) {
    return undefined;
  }
  const selected = selectRustBuiltinErrorPropertyForm(member.memberName, request.accessMode, receiverCarrier!, context.typeDefinitions);
  if (selected.kind === "rejected") return rejectSelectedOperation(request.expression, context, selected.code, selected.message);
  return acceptRustMemberOperation(request, "property", selected.fact, context, options, {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceResultType: request.sourceResultType,
  });
}

import { selectRustRecordObjectOperation, selectRustRecordDeleteOperation } from "../../../policy/operations/source-profiles/js/records.js";
import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult, RustCheckedDeleteSelectionInput, RustCheckedElementSelectionInput, RustCheckedPropertySelectionInput, RustCheckedOperationSelectionResult, RustPolicySelection } from "../../../policy/model/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustRecordCarrierValue } from "../../../target-model/types/carriers/records.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectedValueCarrier } from "../selected-values.js";
import { acceptRustMemberOperation, rejectSelectedOperation } from "./result.js";
import { acceptRustOperation, elementProvenance } from "../../program/records/operations/selected-operation-values.js";
import { normalizeSelectedLiteralCarrier } from "../../source-evidence/types/resolution/selected-literals.js";
import { isRustStringCarrier } from "../../../target-model/types/index.js";
import type { SelectedObjectShapeProjection } from "../../../policy/operations/source-profiles/js/object-fields.js";

import { acceptSelectedCall } from "./calls/instantiation.js";
import { finalizeProviderOperationFromSubjects } from "./conversions.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";

export function selectRustRecordElement(
  request: RustCheckedElementSelectionInput,
  receiver: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const record = rustRecordCarrierValue(receiver);
  if (record === undefined || receiver === undefined) return undefined;
  const selected = request.sourceReceiverType === undefined ? undefined : context.semanticsFor(request.expression)
    .types.selectIndexedAccess(request.sourceReceiverType, request.sourceArgumentType);
  const member = selected?.kind === "resolved" && selected.members.length === 1 ? selected.members[0] : undefined;
  const key = normalizeSelectedLiteralCarrier(request.argument,
    selectedValueCarrier(request.argument, request.sourceArgumentType, context, options), record.key, context, options);
  if (member?.kind !== "index" || !rustTargetTypeRefEquals(key, record.key) ||
      request.accessMode !== "read" && member.index.readonly) {
    return rejectSelectedOperation(request.expression, context, "RUST_RECORD_INDEX_NOT_CLOSED",
      "Record indexing requires an exact checker-selected index, native key and writable storage when mutated.");
  }
  return acceptRustMemberOperation(request, "indexer", {
    kind: "source-index-signature", operationId: "tsonic.rust.record.index", receiverCarrier: receiver,
    accessMode: request.accessMode,
    keyCarrier: record.key, resultCarrier: record.value, writable: !member.index.readonly, storage: { kind: "record" },
  }, context, options, elementProvenance(request));
}

export function selectRustRecordProperty(
  request: RustCheckedPropertySelectionInput,
  receiver: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const index = request.sourceSelectedIndex;
  const record = rustRecordCarrierValue(receiver);
  if (index === undefined || record === undefined || receiver === undefined) return undefined;
  const key = index.keyType === undefined ? undefined : resolveRustTargetTypeRef(index.keyType, context, options);
  if (index.valueType === undefined ||
    context.semanticsFor(request.expression).operations.propertyAccess(request.expression)?.selectedIndex !== index ||
    !isRustStringCarrier(record.key) || !rustTargetTypeRefEquals(key, record.key) ||
    request.accessMode !== "read" && index.readonly) {
    return rejectSelectedOperation(request.expression, context, "RUST_RECORD_INDEX_NOT_CLOSED",
      "Named records require their exact checked string index, native value carrier and writable storage when mutated.");
  }
  return acceptRustMemberOperation(request, "property", {
    kind: "source-index-signature", operationId: "tsonic.rust.record.index", receiverCarrier: receiver,
    accessMode: request.accessMode, keyCarrier: record.key, resultCarrier: record.value,
    writable: !index.readonly, storage: { kind: "record" },
  }, context, options, { sourceExpression: request.expression, sourceReceiver: request.receiver,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration, sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceResultType: request.sourceResultType });
}

export function selectRustRecordObjectCall(
  request: RustCheckedCallSelectionInput,
  projection: SelectedObjectShapeProjection,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> | undefined {
  const source = projection.sourceValue === "receiver" ? request.source.sourceReceiver : request.source.sourceArguments[0];
  const carrier = source === undefined ? undefined : selectedValueCarrier(source.expression, source.type, context, options);
  const record = rustRecordCarrierValue(carrier);
  if (record === undefined || carrier === undefined) return undefined;
  const kind = projection.projection;
  if (!isRustStringCarrier(record.key) || request.source.sourceArguments.length !== projection.expectedArgumentCount) {
    return rejectSelectedOperation(request.source.call, context, "RUST_RECORD_PROJECTION_NOT_CLOSED",
      "Indexed Object operations require exact native string keys and copyable values when selected by the operation.");
  }
  const template = selectRustRecordObjectOperation(kind, projection.static, carrier, record.key, record.value);
  return acceptSelectedCall(request, template, template.parameterCarriers, context, options, { sourceName: projection.sourceName });
}

export function selectRustRecordDelete(
  request: RustCheckedDeleteSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedOperationSelectionResult> | undefined {
  const receiver = resolveRustTargetTypeRef(request.receiver, context, options);
  const record = rustRecordCarrierValue(receiver);
  if (record === undefined || receiver === undefined) return undefined;
  const semantics = context.semanticsFor(request.operand);
  const receiverType = semantics.types.expressionType(request.receiver);
  const keyType = semantics.types.expressionType(request.index);
  const selected = receiverType === undefined || keyType === undefined ? undefined : semantics.types.selectIndexedAccess(receiverType, keyType);
  const index = selected?.kind === "resolved" && selected.members.length === 1 ? selected.members[0] : undefined;
  if (index?.kind !== "index" || index.index.readonly) {
    return rejectSelectedOperation(request.expression, context, "RUST_RECORD_DELETE_NOT_CLOSED",
      "Record deletion requires one exact writable checked index signature.");
  }
  const template = selectRustRecordDeleteOperation(receiver!, record.key);
  const fact = finalizeProviderOperationFromSubjects(template, request.receiver, [request.index], context, options);
  return fact === undefined ? rejectSelectedOperation(request.expression, context, "RUST_RECORD_DELETE_KEY_NOT_CLOSED",
    "Record deletion requires its exact native index key carrier.") : acceptRustOperation(fact, {
      sourceExpression: request.expression, sourceReceiver: request.receiver,
      sourceSelectedDeclaration: request.sourceSelectedDeclaration, sourceSelectedSymbol: request.sourceSelectedSymbol,
    });
}

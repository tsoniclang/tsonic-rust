import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import { acceptRustMemberOperation, normalizeSelectedOperationInputCarrier, rejectSelectedOperation } from "../members/result.js";
import { elementProvenance } from "../../program/records/operations/selected-operation-values.js";

import { finalizeProviderOperationFromSubjects } from "../members/conversions.js";

import { rustFixedArrayCarrierValue, rustSourcePrimitiveTargetType, rustTargetConstInteger } from "../../../target-model/types/index.js";
import { selectRustNativeIndex } from "../../../policy/operations/collections/native-indices.js";
import { selectRustFixedArrayElementPlan, selectRustFixedArrayPropertyPlan } from "../../../policy/operations/collections/fixed-arrays.js";

import { selectTsonicFixedArrayFromSource } from "@tsonic/source-core/facts";
import { sourceIntegerLiteralValue } from "@tsonic/target-api/source";
import { selectedValueCarrier } from "../selected-values.js";
import type { RustCheckedElementSelectionInput, RustCheckedOperationSelectionResult, RustCheckedPropertySelectionInput, RustPolicySelection } from "../../../policy/model/contracts.js";

import type { RustOperationsProviderOptions } from "../members/model.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function selectRustFixedArrayLengthProperty(
  request: RustCheckedPropertySelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
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
  const sourceSelection = request.sourceReceiverType === undefined
    ? undefined
    : selectTsonicFixedArrayFromSource(
        request.sourceReceiverType,
        context.currentSemantics,
        context.source.sourceFacts,
      );
  if (sourceSelection?.kind === "invalid") {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_LENGTH_NOT_CLOSED",
      sourceSelection.reason,
    );
  }
  const sourceFixedArray = sourceSelection?.fact;
  const length = rustTargetConstInteger(fixedArray.length);
  if (sourceFixedArray === undefined || length === undefined || length !== sourceFixedArray.length) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_LENGTH_NOT_CLOSED",
      "The selected FixedArray.length access requires a source fixed-array fact whose exact extent agrees with its receiver carrier.",
    );
  }
  const fact = finalizeProviderOperationFromSubjects(
    selectRustFixedArrayPropertyPlan(),
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

export function selectRustFixedArrayElementAccess(
  request: RustCheckedElementSelectionInput,
  receiverCarrier: TargetTypeRef | undefined,
  context: RustOperationAnalysisContext,
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
  const selectedIndex = request.sourceSelectedElementIndex;
  if (selectedIndex !== undefined && !Number.isSafeInteger(selectedIndex)) {
    return rejectSelectedOperation(request.expression, context, "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN",
      "The selected fixed-array ordinal is not an exact checker integer.");
  }
  const literalIndex = sourceIntegerLiteralValue(context.ast, request.argument);
  const index = selectedIndex === undefined ? literalIndex : BigInt(selectedIndex);
  if (index !== undefined) {
    const length = rustTargetConstInteger(fixedArray.length);
    if (length === undefined) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_FIXED_ARRAY_LENGTH_NOT_CLOSED",
        "Fixed-array element access requires one closed integer extent.",
      );
    }
    if (index < 0n || index >= length || literalIndex !== undefined && literalIndex !== index) {
      return rejectSelectedOperation(
        request.expression,
        context,
        "RUST_FIXED_ARRAY_INDEX_NOT_PROVEN",
        "Fixed-array element access requires an exact ordinal within the finalized bounds and consistent source evidence.",
      );
    }
    return acceptRustMemberOperation(request, "indexer", selectRustFixedArrayElementPlan(fixedArray.element, index),
      context, options, elementProvenance(request), fixedArray.element);
  }
  const dynamicIndexCarrier = selectedValueCarrier(
    request.argument,
    request.sourceArgumentType,
    context,
    options,
  );
  const nativeIndex = selectRustNativeIndex(dynamicIndexCarrier);
  const normalizedIndexCarrier = nativeIndex?.carrier ?? normalizeSelectedOperationInputCarrier(
    request.argument,
    dynamicIndexCarrier,
    rustSourcePrimitiveTargetType("int32"),
    context,
    options,
  );
  const selection = nativeIndex ?? selectRustNativeIndex(normalizedIndexCarrier);
  if (selection === undefined) {
    return rejectSelectedOperation(
      request.expression,
      context,
      "RUST_FIXED_ARRAY_DYNAMIC_INDEX_CARRIER_UNSUPPORTED",
      "Dynamic fixed-array element access requires an exact native integer index carrier; source carriers are not reconstructed from their spelling.",
    );
  }
  const fact = finalizeProviderOperationFromSubjects(
    selectRustFixedArrayElementPlan(fixedArray.element, selection),
    request.receiver,
    [request.argument],
    context,
    options,
    receiverCarrier,
    [selection.carrier],
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

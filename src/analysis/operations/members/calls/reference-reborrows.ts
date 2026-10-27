import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { resolveRustTargetTypeRef } from "../../../source-evidence/types/resolution/source.js";
import type { RustAppliedValueCarrierReconciliation } from "../../../../policy/conversions/value-carrier-reconciliation.js";
import type { RustCheckedCallSelectionInput } from "../../../../policy/model/contracts.js";

import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustEffectiveValueCarrier } from "../../../conversions/value-carrier-queries.js";
import { isRustFinalizedSourceInput } from "../../../../target-model/operations/finalized-inputs.js";
import type { RustOperationsProviderOptions } from "../model.js";

import { selectReferenceReborrow } from "../../../../policy/conversions/reference-reborrows.js";
export function selectReceiverReferenceReborrow(
  request: RustCheckedCallSelectionInput,
  abi: import("../../../../target-model/records/operations/finalized-operation.js").RustFinalizedOperationAbi,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): Extract<
  RustAppliedValueCarrierReconciliation,
  { readonly kind: "conversion" }
> | undefined {
  const receiver = request.source.sourceReceiver;
  if (receiver === undefined || abi.sourceReceiver.kind !== "receiver") {
    return undefined;
  }
  const source = rustEffectiveValueCarrier(context.records, receiver.expression) ??
    resolveRustTargetTypeRef(receiver.expression, context, options);
  const target = abi.sourceReceiver.carrier;
  if (source === undefined || rustTargetTypeRefEquals(source, target)) {
    return undefined;
  }
  const modes = new Set<import("../../../../target-model/operations/model.js").RustArgumentMode>();
  const collect = (
    input: import("../../../../target-model/records/operations/finalized-operation.js").RustFinalizedTargetInput,
  ): void => {
    if (isRustFinalizedSourceInput(input) && input.source.kind === "receiver") {
      modes.add(input.mode);
    }
  };
  if (abi.targetReceiver.kind === "input") {
    collect(abi.targetReceiver.input);
  }
  abi.targetArguments.forEach(collect);
  if (modes.size !== 1) {
    return undefined;
  }
  const conversion = selectReferenceReborrow(
    source,
    target,
    modes.values().next().value,
  );
  return conversion === undefined
    ? undefined
    : {
        kind: "conversion",
        fact: {
          sourceCarrier: source,
          targetCarrier: target,
          conversion,
        },
      };
}

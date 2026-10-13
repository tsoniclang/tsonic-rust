import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution/index.js";
import type { RustAppliedValueCarrierReconciliation } from "../../../../policy/types/resolution/value-carrier-reconciliation.js";
import type { RustCheckedCallSelectionInput } from "../../../../policy/operations/contracts.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustEffectiveValueCarrier } from "../../../conversions/value-carrier-queries.js";
import { isRustFinalizedSourceInput } from "../../finalized-operation/conversions.js";
import type { RustOperationsProviderOptions } from "../model.js";

export function selectReferenceReborrow(
  source: TargetTypeRef,
  target: TargetTypeRef,
  mode: import("../../../../target-model/operations/model.js").RustArgumentMode | undefined,
): Extract<
  import("../../../../target-model/conversions/contextual.js").RustContextualValueConversion,
  { readonly kind: "reference-reborrow" }
> | undefined {
  return source.kind === "reference" &&
      (mode === "ref" || mode === "mut-ref" && source.mutable) &&
      rustTargetTypeRefEquals(source.referent, target)
    ? Object.freeze({ kind: "reference-reborrow", source, target })
    : undefined;
}

export function selectReceiverReferenceReborrow(
  request: RustCheckedCallSelectionInput,
  abi: import("../../../../target-model/records/finalized-operation.js").RustFinalizedOperationAbi,
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
    input: import("../../../../target-model/records/finalized-operation.js").RustFinalizedTargetInput,
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

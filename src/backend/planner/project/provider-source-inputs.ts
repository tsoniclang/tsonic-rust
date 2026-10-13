import type { Node } from "@tsonic/tsts";
import { rustFinalizedSourceInputs } from "../../../analysis/operations/finalized-operation/conversions.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import { isRustAbsenceCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";
import { providerSourceInputKey } from "../../../analysis/operations/provider-source-inputs.js";

export function sourceRuntimeSlots(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
): readonly { readonly key: string; readonly node: Node; readonly evaluationOnly?: "unit" | "value" }[] | undefined {
  const slots: { readonly key: string; readonly node: Node; readonly evaluationOnly?: "unit" | "value" }[] = [];
  if (fact.abi.sourceReceiver.kind === "receiver" &&
    fact.abi.sourceReceiver.disposition === "runtime") {
    if (receiverNode === undefined) {
      return undefined;
    }
    slots.push({ key: "receiver", node: receiverNode });
  }
  for (const argument of fact.abi.sourceArguments) {
    const node = argumentNodes[argument.sourceIndex];
    if (node === undefined) {
      return undefined;
    }
    slots.push({ key: `argument:${argument.sourceIndex}`, node,
      ...(argument.disposition === "evaluation-only" ? {
        evaluationOnly: isRustAbsenceCarrier(argument.carrier) || isRustUnitCarrier(argument.carrier)
          ? "unit" as const : "value" as const,
      } : {}),
    });
  }
  return slots;
}

export function providerTargetRuntimeSlotKeys(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
): readonly string[] {
  return rustFinalizedSourceInputs(fact.abi).map(providerSourceInputKey);
}

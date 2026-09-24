import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../../analysis/facts/finalized-operation-abi.js";
import { isRustFinalizedArrayInput, isRustFinalizedConstantInput, isRustFinalizedSliceInput, isRustFinalizedTaggedArrayInput } from "../../../analysis/facts/finalized-operation-abi.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { isRustAbsenceCarrier, isRustUnitCarrier } from "../../../target-model/types/index.js";

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
  const keys: string[] = [];
  const collect = (input: import("../../../analysis/facts/finalized-operation-abi.js").RustFinalizedTargetInput): void => {
    if (isRustFinalizedConstantInput(input)) {
      return;
    }
    if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
      for (const element of input.elements) {
        keys.push(providerSourceInputKey(element));
      }
      return;
    }
    if (isRustFinalizedTaggedArrayInput(input)) {
      for (const element of input.elements) {
        keys.push(providerSourceInputKey(element.input));
      }
      return;
    }
    keys.push(providerSourceInputKey(input));
  };
  if (fact.abi.targetReceiver.kind === "input") {
    collect(fact.abi.targetReceiver.input);
  }
  for (const input of fact.abi.targetArguments) {
    collect(input);
  }
  return keys;
}

export function providerSourceInputs(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
): readonly RustFinalizedSourceInput[] {
  return [
    ...(fact.abi.targetReceiver.kind === "input"
      ? [fact.abi.targetReceiver.input]
      : []),
    ...fact.abi.targetArguments.flatMap((input) =>
      isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input) ? input.elements :
        isRustFinalizedTaggedArrayInput(input) ? input.elements.map((element) => element.input) :
        isRustFinalizedConstantInput(input) ? [] : [input]),
  ];
}

export function providerSourceInputNode(
  input: RustFinalizedSourceInput,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
): Node | undefined {
  return input.source.kind === "receiver"
    ? receiverNode
    : argumentNodes[input.source.sourceIndex];
}

export function providerSourceInputKey(input: RustFinalizedSourceInput): string {
  return input.source.kind === "receiver"
    ? "receiver"
    : `argument:${input.source.sourceIndex}`;
}

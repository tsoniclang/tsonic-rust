import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";

export function rustProviderOperationSourceReceiverMode(
  fact: RustTargetOperationFact | undefined,
): "value" | "ref" | "mut-ref" | undefined {
  if (fact?.kind !== "provider-operation") {
    return undefined;
  }
  const directInputs = [
    ...(fact.abi.targetReceiver.kind === "input" ? [fact.abi.targetReceiver.input] : []),
    ...fact.abi.targetArguments.flatMap((input) => {
      if ("mode" in input && "source" in input && input.source.kind === "receiver") {
        return [input];
      }
      return [];
    }),
  ];
  const receiverModes = directInputs
    .filter((input) => input.source.kind === "receiver")
    .map((input) => input.mode);
  return receiverModes.length === 1 ? receiverModes[0] : undefined;
}

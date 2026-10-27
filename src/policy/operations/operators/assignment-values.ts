import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function rustSelectedAssignmentValueCarrier(
  fact: RustTargetOperationFact | undefined,
): TargetTypeRef | undefined {
  if (fact?.kind !== "runtime-set") {
    return undefined;
  }
  const values = fact.abi.sourceArguments.filter((argument) =>
    argument.role === "parameter" && argument.disposition === "runtime");
  return values.length === 1 ? values[0]!.carrier : undefined;
}

import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustFinalizedSourceInput } from "../../../target-model/records/operations/finalized-operation.js";

export function rustProviderInputBorrowMode(input: RustFinalizedSourceInput): "ref" | "mut-ref" | undefined {
  if (input.sharedConversion) return "ref";
  if (input.conversion.kind === "identity") {
    if (input.mode !== "value") return input.mode;
    return input.sourceCarrier.kind === "reference" && !input.sourceCarrier.mutable &&
      !input.conversion.fallible &&
      rustTargetTypeRefEquals(input.sourceCarrier, input.conversion.sourceCarrier) &&
      rustTargetTypeRefEquals(input.sourceCarrier, input.conversion.targetCarrier) &&
      rustTargetTypeRefEquals(input.sourceCarrier, input.parameterCarrier) ? "ref" : undefined;
  }
  return undefined;
}

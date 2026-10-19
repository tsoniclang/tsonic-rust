import type { TargetTypeRef } from "../types/model.js";
import { isRustIntegerCarrier, isRustSignedNumericCarrier } from "../types/index.js";
import type { RustProviderOperationForm } from "./model.js";

export function rustLengthEmptinessContractIsValid(input: {
  readonly target: RustProviderOperationForm;
  readonly operationKind: string;
  readonly resultCarrier: TargetTypeRef;
  readonly sourceArgumentCount: number;
  readonly isFallible: boolean;
  readonly isAsync: boolean;
  readonly hasResultConversion: boolean;
  readonly evaluation: string | undefined;
}): boolean {
  const form = input.target;
  if (form.form !== "receiver-method" || form.emptyTestMethod === undefined) return true;
  return input.operationKind === "property" && input.sourceArgumentCount === 0 &&
    !input.isFallible && !input.isAsync && !input.hasResultConversion && input.evaluation === "pure" &&
    isRustIntegerCarrier(input.resultCarrier) && !isRustSignedNumericCarrier(input.resultCarrier) &&
    form.receiverConversion === undefined && form.mutatesReceiver !== true &&
    (form.argModes?.length ?? 0) === 0 && (form.argConversions?.length ?? 0) === 0 &&
    (form.argOrder?.length ?? 0) === 0 && (form.trailingArguments?.length ?? 0) === 0 &&
    (form.chain?.length ?? 0) === 0;
}

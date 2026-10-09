import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { bindRustExactTypeParameters } from "../../target-model/types/carriers/generic-inference.js";

export function bindRustStructuralReceiverParameters(
  template: TargetTypeRef,
  receiver: TargetTypeRef,
  parameters: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  if (rustStructuralObjectCarrierValue(template) === undefined ||
    rustStructuralObjectCarrierValue(receiver) === undefined) return undefined;
  return bindRustExactTypeParameters(template, receiver, parameters);
}

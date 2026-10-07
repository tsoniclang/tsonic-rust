import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { inferRustTargetTypeParameterBindings } from "../../target-model/types/carriers/generic-inference.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function bindRustStructuralReceiverParameters(
  template: TargetTypeRef,
  receiver: TargetTypeRef,
  parameters: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  if (rustStructuralObjectCarrierValue(template) === undefined ||
    rustStructuralObjectCarrierValue(receiver) === undefined) return undefined;
  const bindings = inferRustTargetTypeParameterBindings(template, receiver, parameters);
  return bindings === undefined ||
    !rustTargetTypeRefEquals(substituteRustTargetTypeParameters(template, bindings), receiver)
    ? undefined : bindings;
}

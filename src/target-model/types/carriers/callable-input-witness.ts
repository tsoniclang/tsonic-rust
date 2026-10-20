import type { TargetTypeRef } from "../model.js";

import type { RustLifetimeBinder } from "../../lifetimes/index.js";

export function rustCallableSignatureAbsenceWitness(
  parameters: readonly TargetTypeRef[], result: TargetTypeRef, binder?: RustLifetimeBinder,
): TargetTypeRef {
  return { kind: "function-pointer", args: [{ kind: "tuple", elements: parameters }], result,
    ...(binder === undefined || binder.parameters.length === 0 ? {} : { lifetimeBinder: binder }) };
}

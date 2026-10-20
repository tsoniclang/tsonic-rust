import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustCallableInputProtocol } from "../../../target-model/types/carriers/callables.js";
import { bindRustCallableInputLifetimes } from "./input-lifetimes.js";
import { rustNamedTargetType } from "../../../target-model/types/carriers/native.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";

import { rustCallableSignatureAbsenceWitness } from "../../../target-model/types/carriers/callable-input-witness.js";
export function rustCallableInputAbsenceWitness(carrier: TargetTypeRef): TargetTypeRef | undefined {
  let valid = true;
  const witness = mapRustTargetTypes(carrier, selected => {
    const protocol = rustCallableInputProtocol(selected);
    if (protocol === undefined || selected.kind !== "reference") return selected;
    const signature = bindRustCallableInputLifetimes(protocol.parameters, protocol.result);
    if (signature === undefined) {
      valid = false;
      return selected;
    }
    return { ...selected, referent: rustCallableSignatureAbsenceWitness(signature.parameters,
      rustNamedTargetType("rust.runtime.TsonicResult", "rt::TsonicResult", [
        { kind: "type", type: signature.result },
      ]), signature.binder) };
  });
  return valid ? witness : undefined;
}

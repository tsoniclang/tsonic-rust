import type { TargetTypeRef } from "../model.js";
import { rustCallableInputProtocol } from "./callables.js";
import { bindRustCallableInputLifetimes } from "./callable-input-lifetimes.js";
import { rustNamedTargetType } from "./native.js";
import { mapRustTargetTypes } from "./substitution.js";
import type { RustLifetimeBinder } from "../../lifetimes/index.js";

export function rustCallableSignatureAbsenceWitness(
  parameters: readonly TargetTypeRef[], result: TargetTypeRef, binder?: RustLifetimeBinder,
): TargetTypeRef {
  return { kind: "function-pointer", args: [{ kind: "tuple", elements: parameters }], result,
    ...(binder === undefined || binder.parameters.length === 0 ? {} : { lifetimeBinder: binder }) };
}

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
      ], [], undefined, [], undefined, []), signature.binder) };
  });
  return valid ? witness : undefined;
}

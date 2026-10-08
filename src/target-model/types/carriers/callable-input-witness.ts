import type { TargetTypeRef } from "../model.js";
import { rustCallableInputProtocol } from "./callables.js";
import { bindRustCallableInputLifetimes } from "./callable-input-lifetimes.js";
import { rustNamedTargetType } from "./native.js";
import { mapRustTargetTypes } from "./substitution.js";

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
    return { ...selected, referent: {
      kind: "function-pointer",
      args: [{ kind: "tuple", elements: signature.parameters }],
      result: rustNamedTargetType("rust.runtime.TsonicResult", "rt::TsonicResult", [
        { kind: "type", type: signature.result },
      ]),
      ...(signature.binder.parameters.length === 0 ? {} : { lifetimeBinder: signature.binder }),
    } };
  });
  return valid ? witness : undefined;
}

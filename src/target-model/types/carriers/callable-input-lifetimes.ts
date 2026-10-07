import type { TargetTypeRef } from "../model.js";
import type { RustLifetimeBinder, RustLifetimeRef } from "../../lifetimes/index.js";
import { rustLifetimeKey } from "../../lifetimes/index.js";
import { rustTargetGenericReferences } from "./generic-references.js";
import { mapRustTargetTypes } from "./substitution.js";
import { substituteElidedLifetime } from "./lifetime-elision.js";

export function bindRustCallableInputLifetimes(
  parameters: readonly TargetTypeRef[], result: TargetTypeRef,
): { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef;
  readonly binder: RustLifetimeBinder } | undefined {
  const identity = "rust.callable-input-lifetimes";
  const used = new Set([...parameters, result].flatMap(type => rustTargetGenericReferences(type).lifetimes.map(lifetime => lifetime.name)));
  const fresh = (): Extract<RustLifetimeRef, { readonly kind: "bound" }> => {
    let name = "input";
    while (used.has(name)) name = `_${name}`;
    used.add(name);
    return { kind: "bound", binderIdentity: identity, identity: `${identity}\0${name}`, name };
  };
  const selected = parameters.map(parameter => mapRustTargetTypes(parameter, (type, source) => {
    if (source.kind === "function-pointer" || source.kind === "closure" || source.kind === "trait-ref") return source;
    if (type.kind === "reference" && (type.lifetime === undefined || type.lifetime.kind === "placeholder"))
      return { ...type, lifetime: fresh() };
    return type.kind === "target-named" && type.genericArguments !== undefined ? { ...type,
      genericArguments: type.genericArguments.map(argument => argument.kind === "lifetime" && argument.lifetime.kind === "placeholder"
        ? { ...argument, lifetime: fresh() } : argument),
    } : type;
  }));
  const bound = selected.flatMap(type => rustTargetGenericReferences(type).lifetimes)
    .filter((lifetime): lifetime is Extract<RustLifetimeRef, { readonly kind: "bound" }> =>
      lifetime.kind === "bound" && lifetime.binderIdentity === identity);
  const inputs = [...new Map(selected.flatMap(type => rustTargetGenericReferences(type).elisionInputs)
    .map(lifetime => [rustLifetimeKey(lifetime), lifetime])).values()];
  const elidedResult = rustTargetGenericReferences(result).elisionInputs.some(lifetime => lifetime.kind === "placeholder");
  if (elidedResult && inputs.length !== 1) return undefined;
  return Object.freeze({ parameters: Object.freeze(selected), result: elidedResult ? substituteElidedLifetime(result, inputs[0]!) : result,
    binder: Object.freeze({ identity, parameters: Object.freeze([...new Map(bound.map(lifetime => [rustLifetimeKey(lifetime), lifetime])).values()]
      .map(lifetime => Object.freeze({ lifetime, outlives: Object.freeze([]) }))) }) });
}

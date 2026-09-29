import type { RustLifetimeRef } from "../../lifetimes/index.js";
import { rustLifetimeKey, rustPlaceholderLifetime } from "../../lifetimes/index.js";
import { rustNativeRepresentationMatches } from "../../conversions/native-representation.js";
import type { TargetTypeRef } from "../model.js";
import { rustTargetGenericReferences } from "./generic-references.js";
import { substituteRustTargetGenerics } from "./substitution.js";

export function rustSingleElidedInput(parameters: readonly TargetTypeRef[]): number | undefined {
  const inputs = parameters.flatMap((parameter, index) =>
    rustTargetGenericReferences(parameter).elisionInputs.map(lifetime => ({ index, lifetime })));
  return inputs.length === 1 && inputs[0]!.lifetime.kind === "placeholder" ? inputs[0]!.index : undefined;
}

export function instantiateRustElidedCallResult(
  result: TargetTypeRef,
  parameters: readonly TargetTypeRef[],
  arguments_: readonly { readonly parameterIndex: number; readonly carrier: TargetTypeRef }[],
): TargetTypeRef {
  if (!rustTargetGenericReferences(result).elisionInputs.some(lifetime => lifetime.kind === "placeholder")) return result;
  const parameterIndex = rustSingleElidedInput(parameters);
  if (parameterIndex === undefined) return result;
  const inputs = arguments_.filter(argument => argument.parameterIndex === parameterIndex);
  if (inputs.length !== 1) return result;
  const source = inputs[0]!.carrier;
  const lifetimes = rustTargetGenericReferences(source).elisionInputs;
  if (lifetimes.length !== 1 || lifetimes[0]!.kind === "bound" || lifetimes[0]!.kind === "call-scoped-elision") return result;
  const lifetime = lifetimes[0]!;
  const parameter = substituteElidedLifetime(parameters[parameterIndex]!, lifetime);
  return rustNativeRepresentationMatches(source, parameter) ? substituteElidedLifetime(result, lifetime) : result;
}

export function bindRustElidedCallableInput(
  parameters: readonly TargetTypeRef[], result: TargetTypeRef,
  lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>,
): { readonly parameterIndex: number; readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef } | undefined {
  const parameterIndex = rustSingleElidedInput(parameters);
  if (parameterIndex === undefined) return undefined;
  return Object.freeze({ parameterIndex,
    parameters: Object.freeze(parameters.map((parameter, index) =>
      index === parameterIndex ? substituteElidedLifetime(parameter, lifetime) : parameter)),
    result: substituteElidedLifetime(result, lifetime),
  });
}

function substituteElidedLifetime(type: TargetTypeRef, lifetime: RustLifetimeRef): TargetTypeRef {
  return substituteRustTargetGenerics(type, new Map(),
    new Map([[rustLifetimeKey(rustPlaceholderLifetime), lifetime]]), new Map(), (selected, source) => {
      if (source.kind === "function-pointer" || source.kind === "closure") return source;
      return selected.kind === "reference" && selected.lifetime === undefined ? { ...selected, lifetime } : selected;
    });
}

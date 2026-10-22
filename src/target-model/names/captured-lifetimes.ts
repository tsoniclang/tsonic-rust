import { rustLifetimeKey, type RustLifetimeRef, type RustSourceGenericParameterContract } from "../lifetimes/index.js";
import { allocateRustGeneratedName } from "./generated.js";

/**
 * A lexical function binds the outer lifetimes it captures as its own generic parameters, named apart from the lifetime
 * parameters it declares (an inner `Region` keeps its name; a captured outer `Region` becomes `Region_2`).
 */
export function rustCapturedLifetimeSubstitutions(
  own: readonly RustSourceGenericParameterContract[],
  captured: readonly RustSourceGenericParameterContract[],
): ReadonlyMap<string, RustLifetimeRef> {
  const names = new Set(own.flatMap(parameter => parameter.kind === "lifetime" ? [parameter.lifetime.name] : []));
  const substitutions = new Map<string, RustLifetimeRef>();
  for (const parameter of captured) {
    if (parameter.kind !== "lifetime") continue;
    substitutions.set(rustLifetimeKey(parameter.lifetime),
      Object.freeze({ ...parameter.lifetime, name: allocateRustGeneratedName(names, parameter.lifetime.name) }));
  }
  return substitutions;
}

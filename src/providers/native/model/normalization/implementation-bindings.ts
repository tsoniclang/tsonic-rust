import type { RustCompilerConstArgument, RustCompilerGenericParameter, RustCompilerLifetime, RustCompilerType } from "../model.js";
import { substituteRustCompilerType, type RustCompilerSubstitutions } from "../rustdoc-types.js";
import { compilerTypeGenericIdentities } from "../types/generic-references.js";

export function implementationSubstitutions(
  parameters: readonly RustCompilerGenericParameter[],
  positions: ReadonlyMap<string, number>,
  declared: readonly RustCompilerGenericParameter[],
): RustCompilerSubstitutions {
  const types = new Map<string, RustCompilerType>();
  const lifetimes = new Map<string, RustCompilerLifetime>();
  const consts = new Map<string, RustCompilerConstArgument>();
  const remaining: RustCompilerGenericParameter[] = [];
  for (const parameter of parameters) {
    const identity = parameter.kind === "lifetime"
      ? parameter.lifetime.kind === "parameter" ? parameter.lifetime.identity.itemId : parameter.lifetime.identity
      : parameter.identity.itemId;
    const position = positions.get(identity);
    const selected = position === undefined ? undefined : declared[position];
    if (selected === undefined) { remaining.push(parameter); continue; }
    if (parameter.kind === "type" && selected.kind === "type") {
      types.set(identity, { kind: "generic", identity: selected.identity, name: selected.name });
    } else if (parameter.kind === "lifetime" && selected.kind === "lifetime") {
      lifetimes.set(identity, selected.lifetime);
    } else if (parameter.kind === "const" && selected.kind === "const") {
      consts.set(identity, { kind: "parameter", identity: selected.identity, name: selected.name });
    } else throw new Error("Rust impl generic parameter kind differs from its owning declaration.");
  }
  const bindings = Object.freeze({ types, lifetimes, consts });
  const declaredTypes = new Set(declared.flatMap(parameter => parameter.kind === "type" ? [parameter.identity.itemId] : []));
  for (const parameter of remaining) {
    if (parameter.kind !== "type") throw new Error("Rust impl generic parameter has no exact owner projection.");
    const candidates: RustCompilerType[] = [];
    for (const owner of parameters) {
      if (owner.kind !== "type" || !types.has(owner.identity.itemId)) continue;
      for (const requirement of owner.requirements) {
        if (typeof requirement === "string") continue;
        for (const equality of requirement.trait.associatedConstraints) {
          if (equality.kind !== "equality" || equality.type.kind !== "generic" ||
            equality.type.identity.itemId !== parameter.identity.itemId) continue;
          candidates.push({ kind: "associated-type", identity: equality.identity, name: equality.name,
            owner: { kind: "generic", identity: owner.identity, name: owner.name },
            trait: { ...requirement.trait, associatedConstraints: [] },
            genericArguments: equality.genericArguments, maybeSized: false });
        }
      }
    }
    if (candidates.length !== 1) throw new Error("Rust impl generic parameter requires one exact associated-type equality.");
    const selected = substituteRustCompilerType(candidates[0]!, bindings);
    if ([...compilerTypeGenericIdentities(selected)].some(identity => !declaredTypes.has(identity))) {
      throw new Error("Rust impl associated-type equality is cyclic or depends on an unbound parameter.");
    }
    types.set(parameter.identity.itemId, selected);
  }
  return bindings;
}

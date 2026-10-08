import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustGenericRequirement } from "./generic-requirements.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";

export interface RustAssociatedTypeRequirement {
  readonly carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>;
  readonly requirements: readonly RustGenericRequirement[];
  readonly fieldAccess?: readonly ("read" | "write")[];
  readonly output?: TargetTypeRef;
}

export function createRustAssociatedRequirementCollector(
  declared: ReadonlySet<string>,
  families: RustSourceTypeFamilyRegistry,
  classify: (carrier: TargetTypeRef, requirements: readonly RustGenericRequirement[]) => boolean,
): {
  require(carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>, requirement?: RustGenericRequirement): boolean;
  requireField(carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>, access: readonly ("read" | "write")[], output?: TargetTypeRef): boolean;
  collect(carrier: TargetTypeRef): boolean;
  seal(): readonly RustAssociatedTypeRequirement[];
} {
  const entries: { carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>; requirements: Set<RustGenericRequirement>; fieldAccess: Set<"read" | "write">; output?: TargetTypeRef }[] = [];
  const require = (carrier: Extract<TargetTypeRef, { readonly kind: "associated-type" }>, requirement?: RustGenericRequirement): boolean => {
    if (carrier.trait === undefined || families.get(carrier.trait.id) === undefined) return false;
    const references = rustTargetTypeParameterIdentities(carrier);
    if (references.length === 0) {
      const implementation = families.implementation(carrier.trait, carrier.owner);
      return implementation !== undefined && (requirement === undefined || classify(implementation.output, [requirement]));
    }
    if (!references.every(name => declared.has(name))) return false;
    let entry = entries.find(candidate => rustTargetTypeRefEquals(candidate.carrier, carrier));
    if (entry === undefined) {
      entry = { carrier, requirements: new Set(), fieldAccess: new Set() };
      entries.push(entry);
    }
    if (requirement !== undefined) entry.requirements.add(requirement);
    return true;
  };
  const collect = (carrier: TargetTypeRef): boolean => {
    if (carrier.kind === "associated-type" && carrier.trait !== undefined &&
      families.get(carrier.trait.id) !== undefined && !require(carrier)) return false;
    return rustTargetTypeChildren(carrier).every(collect);
  };
  return {
    require,
    requireField(carrier, access, output) {
      if (carrier.trait === undefined || families.get(carrier.trait.id)?.kind !== "indexed" || !require(carrier)) return false;
      const entry = entries.find(candidate => rustTargetTypeRefEquals(candidate.carrier, carrier));
      if (entry === undefined) {
        const implementation = families.implementation(carrier.trait, carrier.owner);
        const field = implementation?.field;
        return field !== undefined && (!access.includes("write") || field.sharedWrite) &&
          (output === undefined || rustTargetTypeRefEquals(output, implementation?.output));
      }
      if (output !== undefined && !rustTargetTypeRefEquals(output, carrier)) {
        if (entry.output !== undefined && !rustTargetTypeRefEquals(entry.output, output)) return false;
        entry.output = output;
      }
      for (const mode of access) entry.fieldAccess.add(mode);
      return true;
    },
    collect,
    seal: () => Object.freeze(entries.map(entry => Object.freeze({ carrier: entry.carrier,
      ...(entry.output === undefined ? {} : { output: entry.output }),
      ...(entry.fieldAccess.size === 0 ? {} : { fieldAccess: Object.freeze([...entry.fieldAccess].sort()) }),
      requirements: Object.freeze([...entry.requirements].sort()) }))),
  };
}

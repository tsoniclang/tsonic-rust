import type { TargetTypeRef } from "../../target-model/types/model.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import type { RustSourceTypeFamilyRegistry } from "./type-families.js";

export function rustTypeFamilyNormalizer(
  families: Pick<RustSourceTypeFamilyRegistry, "implementation">,
): (carrier: TargetTypeRef) => TargetTypeRef {
  const active = new Set<string>();
  const normalize = (carrier: TargetTypeRef): TargetTypeRef => {
    if (carrier.kind !== "associated-type" || carrier.trait === undefined) return carrier;
    const selected = families.implementation(carrier.trait, carrier.owner);
    if (selected === undefined) return carrier;
    const identity = closedMetadataKey({ trait: carrier.trait, owner: carrier.owner });
    if (active.has(identity)) throw new Error("A checked source type family contains a recursive native output equation.");
    active.add(identity);
    try { return mapRustTargetTypes(selected.output, normalize); }
    finally { active.delete(identity); }
  };
  return normalize;
}

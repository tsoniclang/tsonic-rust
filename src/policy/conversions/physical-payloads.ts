import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustSourceUnionDefinitionIdentity } from "../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustUnionAlternatives, rustUnionProjectionContract } from "../../target-model/types/union-relations.js";
import { rustRuntimeUnionContract } from "../../target-model/types/carriers/runtime-unions.js";
import { rustSourceUnionCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";

export function rustPhysicalPayloadFor(
  logical: TargetTypeRef,
  physical: TargetTypeRef,
  payload: TargetTypeRef,
  definitions: RustTypeDefinitions,
): TargetTypeRef | undefined {
  if (!isRustTargetTypeRef(logical) || !isRustTargetTypeRef(physical) || !isRustTargetTypeRef(payload)) return undefined;
  for (let depth = 0; depth < 128; depth += 1) {
    if (rustTargetTypeRefEquals(logical, payload)) return physical;
    const optional = rustOptionElementCarrier(logical);
    if (optional !== undefined) {
      const present = rustOptionElementCarrier(physical);
      if (present === undefined) return undefined;
      logical = optional;
      physical = present;
      continue;
    }
    if (logical.kind === "reference") {
      if (physical.kind !== "reference" || logical.mutable !== physical.mutable ||
        !rustLifetimesEqual(logical.lifetime, physical.lifetime)) return undefined;
      logical = logical.referent;
      physical = physical.referent;
      continue;
    }
    const projection = rustUnionProjectionContract(logical, payload, definitions);
    if (projection === undefined) return undefined;
    for (const step of projection.path) {
      const identity = rustSourceUnionDefinitionIdentity(step.union);
      if (identity !== undefined ? identity !== rustSourceUnionDefinitionIdentity(physical) || !closedMetadataEquals(
        rustSourceUnionCarrierValue(step.union)!.genericArguments, rustSourceUnionCarrierValue(physical)?.genericArguments)
        : step.union.kind !== "target-named" || physical.kind !== "target-named" || step.union.id !== physical.id ||
          rustRuntimeUnionContract(step.union) === undefined || rustRuntimeUnionContract(physical) === undefined) return undefined;
      const variants = rustUnionAlternatives(physical, definitions);
      const selected = variants?.filter(variant => variant.variant.kind === "payload" &&
        step.variant.kind === "payload" && variant.variant.name === step.variant.name);
      if (selected?.length !== 1) return undefined;
      physical = selected[0]!.carrier;
    }
    return physical;
  }
  return undefined;
}

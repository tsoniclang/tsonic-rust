import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { isRustUnionArmMappings } from "../../target-model/types/union-relations.js";
import { selectRustUnionArmMapping } from "./union-relations.js";
import { closedMetadataEquals, hasExactObjectKeys, isClosedMetadata, isDenseDataArray, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

import type { RustProjectUpcastRelation, RustProjectUnionMapArm, RustProjectUnionMapConversion } from "../../target-model/conversions/project-union.js";
export function selectRustProjectUnionMapConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions,
  relation: RustProjectUpcastRelation,
): RustProjectUnionMapConversion | undefined {
  const upcasts = new Map<TargetTypeRef, NonNullable<RustProjectUnionMapArm["upcast"]>>();
  let ambiguous = false;
  const arms = selectRustUnionArmMapping(source, target, "source", definitions, (sourceCarrier, targetCarrier) => {
    if (rustSourceTypeCarrierValue(sourceCarrier)?.shape !== "object" ||
      rustSourceTypeCarrierValue(targetCarrier)?.shape !== "object") return false;
    const selected = relation(sourceCarrier, targetCarrier);
    if (selected === "ambiguous") ambiguous = true;
    if (selected !== "related") return false;
    upcasts.set(sourceCarrier, { sourceCarrier, targetCarrier });
    return true;
  });
  return arms === undefined || ambiguous || upcasts.size === 0 ? undefined : snapshotClosedMetadata({
    kind: "project-union-map", source, target,
    arms: arms.map(arm => ({ ...arm, upcast: upcasts.get(arm.carrier) ?? null })),
  });
}

export function isRustProjectUnionMapConversion(value: unknown): value is RustProjectUnionMapConversion {
  if (!isClosedMetadata(value) || value === null || typeof value !== "object" ||
    !hasExactObjectKeys(value, ["kind", "source", "target", "arms"])) return false;
  const conversion = value as RustProjectUnionMapConversion;
  return conversion.kind === "project-union-map" && isRustTargetTypeRef(conversion.source) &&
    isRustTargetTypeRef(conversion.target) && isDenseDataArray(conversion.arms) && conversion.arms.length > 0 &&
    conversion.arms.some(arm => arm !== null && typeof arm === "object" && arm.upcast !== null) &&
    conversion.arms.every(arm => {
      if (arm === null || typeof arm !== "object" ||
        !hasExactObjectKeys(arm, ["carrier", "source", "target", "upcast"])) return false;
      const { upcast, ...correspondence } = arm;
      if (!isRustUnionArmMappings([correspondence])) return false;
      return upcast === null || upcast !== null && typeof upcast === "object" &&
        hasExactObjectKeys(upcast, ["sourceCarrier", "targetCarrier"]) &&
        isRustTargetTypeRef(upcast.sourceCarrier) && isRustTargetTypeRef(upcast.targetCarrier) &&
        rustSourceTypeCarrierValue(upcast.sourceCarrier)?.shape === "object" &&
        rustSourceTypeCarrierValue(upcast.targetCarrier)?.shape === "object" &&
        rustTargetTypeRefEquals(upcast.sourceCarrier, arm.carrier) &&
        !rustTargetTypeRefEquals(upcast.sourceCarrier, upcast.targetCarrier);
    });
}

export function rustProjectUnionMapConversionMatches(
  value: unknown,
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions,
  relation: RustProjectUpcastRelation | undefined,
): boolean {
  if (relation === undefined || !isRustProjectUnionMapConversion(value) ||
    !rustTargetTypeRefEquals(source, value.source) || !rustTargetTypeRefEquals(target, value.target)) return false;
  const selected = selectRustProjectUnionMapConversion(source, target, definitions, relation);
  return selected !== undefined && closedMetadataEquals(selected, value);
}

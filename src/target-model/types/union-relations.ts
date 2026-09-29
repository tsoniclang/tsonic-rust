import type { TargetTypeRef } from "./model.js";
import type { RustTypeDefinitions } from "./source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "./equality.js";
import { rustRuntimeUnionContract, type RustRuntimeUnionVariant } from "./carriers/runtime-unions.js";
import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";

export interface RustUnionArmMapping {
  readonly carrier: TargetTypeRef;
  readonly source: RustRuntimeUnionVariant;
  readonly target: RustRuntimeUnionVariant;
}

export function isRustUnionArmMappings(value: unknown): value is readonly RustUnionArmMapping[] {
  if (!isClosedMetadata(value) || !isDenseDataArray(value) || value.length === 0) return false;
  return value.every(arm => arm !== null && typeof arm === "object" &&
    hasExactObjectKeys(arm, ["carrier", "source", "target"]) &&
    isRustTargetTypeRef((arm as RustUnionArmMapping).carrier) &&
    isVariant((arm as RustUnionArmMapping).source) && isVariant((arm as RustUnionArmMapping).target));
}

function isVariant(value: unknown): value is RustRuntimeUnionVariant {
  if (value === null || typeof value !== "object") return false;
  const variant = value as RustRuntimeUnionVariant;
  return typeof variant.name === "string" && variant.name.length > 0 && (
    variant.kind === "payload" && hasExactObjectKeys(value, ["kind", "name"]) ||
    variant.kind === "constant" && hasExactObjectKeys(value, ["kind", "name", "value"]) && typeof variant.value === "boolean");
}

export function rustUnionAlternatives(carrier: TargetTypeRef, definitions: RustTypeDefinitions) {
  return definitions.sourceUnionVariants(carrier)?.map(variant => ({
    carrier: variant.carrier, variant: { kind: "payload" as const, name: variant.name },
  })) ?? rustRuntimeUnionContract(carrier)?.alternatives;
}

export function selectRustUnionArmMapping(
  source: TargetTypeRef,
  target: TargetTypeRef,
  coverage: "source" | "target",
  definitions: RustTypeDefinitions,
): readonly RustUnionArmMapping[] | undefined {
  if (coverage !== "source" && coverage !== "target") return undefined;
  const sourceArms = rustUnionAlternatives(source, definitions);
  const targetArms = rustUnionAlternatives(target, definitions);
  if (sourceArms === undefined || targetArms === undefined) return undefined;
  const mappings: RustUnionArmMapping[] = [];
  const selectedTargets = new Set<string>();
  for (const arm of sourceArms) {
    const matches = targetArms.filter(candidate => rustTargetTypeRefEquals(arm.carrier, candidate.carrier));
    if (matches.length > 1 || coverage === "source" && matches.length !== 1) return undefined;
    const selected = matches[0];
    if (selected === undefined) continue;
    if (selectedTargets.has(selected.variant.name) || selected.variant.kind === "constant" &&
      (arm.variant.kind !== "constant" || arm.variant.value !== selected.variant.value)) return undefined;
    selectedTargets.add(selected.variant.name);
    mappings.push(Object.freeze({ carrier: arm.carrier, source: arm.variant, target: selected.variant }));
  }
  return mappings.length === 0 || coverage === "target" && selectedTargets.size !== targetArms.length
    ? undefined : Object.freeze(mappings);
}

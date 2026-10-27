import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustUnionArmMapping } from "../../target-model/types/union-relations.js";
import { rustUnionLeaves } from "../../target-model/types/union-relations.js";
import { composeRustUnionArmMappings, rustUnionArmMappingsMatch, rustUnionProjectionContract } from "./union-relations.js";
import type { RustUnionProjectionEmission, RustUnionMappingEmission } from "../../target-model/records/types/union-mappings.js";

export function selectRustUnionProjectionEmission(source: TargetTypeRef, target: TargetTypeRef,
  definitions: RustTypeDefinitions): RustUnionProjectionEmission | undefined {
  const selected = rustUnionProjectionContract(source, target, definitions);
  return selected === undefined ? undefined : Object.freeze({ dispatchCarrier: selected.dispatchCarrier,
    carrier: selected.carrier, variant: selected.variant, path: selected.path, sourceOptional: selected.sourceOptional,
    targetOptional: selected.targetOptional, exhaustive: selected.exhaustive });
}

export function selectRustUnionMappingEmission(source: TargetTypeRef, target: TargetTypeRef,
  mappings: readonly RustUnionArmMapping[], coverage: "source" | "target", sourceOptional: boolean,
  targetOptional: boolean, definitions: RustTypeDefinitions,
  relates?: (source: TargetTypeRef, target: TargetTypeRef) => boolean,
  upstream?: { readonly carrier: TargetTypeRef; readonly arms: readonly RustUnionArmMapping[] }): RustUnionMappingEmission | undefined {
  const selected = upstream === undefined
    ? rustUnionArmMappingsMatch(source, target, coverage, definitions, mappings, relates) ? mappings : undefined
    : coverage === "target" ? composeRustUnionArmMappings(source, upstream.carrier, target, upstream.arms, mappings, definitions, relates) : undefined;
  if (selected === undefined || targetOptional && !sourceOptional) return undefined;
  const leaves = rustUnionLeaves(source, definitions);
  if (leaves === undefined) return undefined;
  return Object.freeze({ arms: Object.freeze([...selected]), sourceOptional, targetOptional,
    excluded: coverage === "target" && selected.length < leaves.length || sourceOptional && !targetOptional });
}

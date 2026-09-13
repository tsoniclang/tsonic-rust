import type { RustSourceUnion } from "../../policy/types/source-type-registry.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustSourceUnionCarrierValue } from "../../target-model/types/carriers/source-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export interface RustGeneratedUnionDefinition {
  readonly ownerFileName: string;
  readonly componentId: string;
  readonly targetName: string;
  readonly variantNames: readonly string[];
  readonly sourceCarriers: readonly TargetTypeRef[];
}

export interface RustGeneratedUnionPlan {
  readonly unionDefinitions: readonly RustGeneratedUnionDefinition[];
  unionForCarrier(carrier: TargetTypeRef): RustGeneratedUnionDefinition | undefined;
}

export function createRustGeneratedUnionPlan(
  unions: readonly RustSourceUnion[],
  componentForFile: (fileName: string) => string,
  usedNamesByComponent: Map<string, Set<string>>,
): RustGeneratedUnionPlan {
  const groups = new Map<string, { ownerFileName: string; componentId: string; variantNames: readonly string[]; carriers: Map<string, TargetTypeRef> }>();
  for (const union of unions) {
    const value = rustSourceUnionCarrierValue(union.carrier);
    if (union.declaration !== undefined || value?.origin !== "generated") {
      throw new Error("A generated union plan requires an exact inferred union contract.");
    }
    const componentId = componentForFile(value.fileName);
    if (componentId === undefined) throw new Error("A generated union has no source-package owner.");
    const key = JSON.stringify([componentId, value.variants.length]);
    const group = groups.get(key) ?? { ownerFileName: value.fileName, componentId, variantNames: Object.freeze(value.variants.map(variant => variant.name)), carriers: new Map() };
    if (value.fileName.localeCompare(group.ownerFileName, "en") < 0) group.ownerFileName = value.fileName;
    group.carriers.set(closedMetadataKey(union.carrier), union.carrier);
    groups.set(key, group);
  }
  const definitions = [...groups].sort(([left], [right]) => left.localeCompare(right, "en")).map(([, group]) => {
    const names = usedNamesByComponent.get(group.componentId) ?? new Set<string>();
    usedNamesByComponent.set(group.componentId, names);
    return Object.freeze({
      ownerFileName: group.ownerFileName,
      componentId: group.componentId,
      targetName: allocateRustGeneratedName(names, `Union${group.variantNames.length}`),
      variantNames: group.variantNames,
      sourceCarriers: Object.freeze([...group.carriers].sort(([left], [right]) => left.localeCompare(right, "en")).map(([, carrier]) => carrier)),
    });
  });
  const byCarrier = new Map(definitions.flatMap(definition => definition.sourceCarriers.map(carrier => [closedMetadataKey(carrier), definition] as const)));
  return Object.freeze({
    unionDefinitions: Object.freeze(definitions),
    unionForCarrier(carrier: TargetTypeRef) {
      return rustSourceUnionCarrierValue(carrier)?.origin === "generated" ? byCarrier.get(closedMetadataKey(carrier)) : undefined;
    },
  });
}

import { closedMetadataKey, hasExactObjectKeys, isClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustNumberArrayPayload } from "../../../target-model/types/carriers/array-unions.js";
import { instantiateRustSourceUnionVariants, rustSourceUnionDefinitionIdentity, type RustSourceUnionDefinition } from "../../../target-model/types/source-union-definitions.js";
import { createRustSourceUnionPayloadTemplate } from "../../project-types/source-union-payloads.js";
import type { RustGeneratedUnionDefinition } from "../../../target-model/records/types/generated-unions.js";

export interface RustGeneratedUnionPlan {
  readonly unionDefinitions: readonly RustGeneratedUnionDefinition[];
  unionForCarrier(carrier: TargetTypeRef): RustGeneratedUnionDefinition | undefined;
}

export function createRustGeneratedUnionPlan(
  unions: readonly RustSourceUnionDefinition[],
  componentForFile: (fileName: string) => string,
  usedNamesByComponent: Map<string, Set<string>>,
): RustGeneratedUnionPlan {
  if (!isClosedMetadata(unions) || !isDenseDataArray(unions))
    throw new Error("A generated union plan requires exact immutable union definitions.");
  const groups = new Map<string, { ownerFileName: string; componentId: string; variantNames: readonly string[]; carriers: Map<string, TargetTypeRef> }>();
  const sourceDefinitions = new Map<string, RustSourceUnionDefinition>();
  for (const union of unions) {
    if (union === null || typeof union !== "object" || !hasExactObjectKeys(union, ["carrier", "variants"]))
      throw new Error("A generated union plan requires an exact inferred union contract.");
    const value = rustSourceUnionCarrierValue(union.carrier);
    if (value?.origin !== "generated" ||
      value.payloads.kind !== "physical" || !isDenseDataArray(union.variants) || union.variants.length !== value.payloads.types.length ||
      union.variants.some((variant, index) => {
        return variant === null || typeof variant !== "object" || !hasExactObjectKeys(variant, ["name", "carrier"]) ||
          variant.name !== `Variant${index}` || value.payloads.kind !== "physical" ||
          !rustTargetTypeRefEquals(variant.carrier, value.payloads.types[index]);
      })) {
      throw new Error("A generated union plan requires an exact inferred union contract.");
    }
    const componentId = componentForFile(value.fileName);
    if (componentId === undefined) throw new Error("A generated union has no source-package owner.");
    const key = JSON.stringify([componentId, union.variants.length]);
    const group = groups.get(key) ?? { ownerFileName: value.fileName, componentId, variantNames: Object.freeze(union.variants.map(variant => variant.name)), carriers: new Map() };
    if (value.fileName.localeCompare(group.ownerFileName, "en") < 0) group.ownerFileName = value.fileName;
    group.carriers.set(closedMetadataKey(union.carrier), union.carrier);
    sourceDefinitions.set(closedMetadataKey(union.carrier), { carrier: union.carrier,
      variants: union.variants.map(variant => ({ name: variant.name, carrier: variant.carrier })) });
    groups.set(key, group);
  }
  const definitions = [...groups].sort(([left], [right]) => left.localeCompare(right, "en")).map(([, group]) => {
    const names = usedNamesByComponent.get(group.componentId) ?? new Set<string>();
    usedNamesByComponent.set(group.componentId, names);
    const carriers = [...group.carriers].sort(([left], [right]) => left.localeCompare(right, "en"));
    const payloadTemplate = createRustSourceUnionPayloadTemplate(sourceDefinitions.get(carriers[0]![0])!, () => undefined);
    if (payloadTemplate === undefined) throw new Error("A generated union requires one exact payload template.");
    return Object.freeze({
      ownerFileName: group.ownerFileName,
      componentId: group.componentId,
      targetName: allocateRustGeneratedName(names, `Union${group.variantNames.length}`),
      payloadTemplate,
      numberArrayLike: [...group.carriers.values()].some(carrier =>
        rustSourceUnionCarrierValue(carrier)!.payloads.kind === "physical" &&
        sourceDefinitions.get(closedMetadataKey(carrier))!.variants.every(variant => isRustNumberArrayPayload(variant.carrier))),
      sourceCarriers: Object.freeze(carriers.map(([, carrier]) => carrier)),
    });
  });
  const bySchema = new Map(definitions.flatMap(definition => definition.sourceCarriers.map(carrier => {
    const template = sourceDefinitions.get(closedMetadataKey(carrier))!;
    return [rustSourceUnionDefinitionIdentity(carrier)!, { definition, template }] as const;
  })));
  return Object.freeze({
    unionDefinitions: Object.freeze(definitions),
    unionForCarrier(carrier: TargetTypeRef) {
      const value = rustSourceUnionCarrierValue(carrier);
      const identity = rustSourceUnionDefinitionIdentity(carrier);
      const schema = value?.origin !== "generated" || identity === undefined ? undefined : bySchema.get(identity);
      return schema !== undefined && instantiateRustSourceUnionVariants(schema.template, carrier) !== undefined
        ? schema.definition : undefined;
    },
  });
}

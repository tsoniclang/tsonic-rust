import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustSourceUnionCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { closedMetadataKey, hasExactObjectKeys, isClosedMetadata, isDenseDataArray, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { instantiateRustSourceUnionVariants, rustSourceUnionDefinitionIdentity,
  type RustTypeDefinitions, type RustSourceUnionDefinition } from "../../target-model/types/source-union-definitions.js";

export interface RustTypeDefinitionRegistry extends RustTypeDefinitions {
  registerSourceUnion(definition: RustSourceUnionDefinition, template: boolean): boolean;
  definitionCarriers(): readonly TargetTypeRef[];
  seal(): RustTypeDefinitions;
}

export function createRustTypeDefinitionRegistry(): RustTypeDefinitionRegistry {
  const definitions = new Map<string, RustSourceUnionDefinition>();
  const templates = new Map<string, RustSourceUnionDefinition>();
  let sealed = false;
  const sourceUnionVariants: RustTypeDefinitions["sourceUnionVariants"] = carrier => {
    if (!isRustTargetTypeRef(carrier)) return undefined;
    const exact = definitions.get(closedMetadataKey(carrier));
    if (exact !== undefined) return exact.variants;
    const identity = rustSourceUnionDefinitionIdentity(carrier);
    const template = identity === undefined ? undefined : templates.get(identity);
    return template === undefined ? undefined : instantiateRustSourceUnionVariants(template, carrier);
  };
  return Object.freeze({
    sourceUnionVariants,
    definitionCarriers: () => Object.freeze([...definitions.values()].flatMap(definition => definition.variants.map(variant => variant.carrier))),
    registerSourceUnion(definition: RustSourceUnionDefinition, template: boolean) {
      if (sealed) throw new Error("Rust type definitions are sealed.");
      if (typeof template !== "boolean" || definition === null || typeof definition !== "object" || !isClosedMetadata(definition) ||
        !hasExactObjectKeys(definition, ["carrier", "variants"]) || !isRustTargetTypeRef(definition.carrier)) return false;
      const value = rustSourceUnionCarrierValue(definition.carrier);
      const identity = rustSourceUnionDefinitionIdentity(definition.carrier);
      if (identity === undefined || value === undefined || !isDenseDataArray(definition.variants) ||
        definition.variants.length < 2 ||
        definition.variants.some(variant => variant === null || typeof variant !== "object" ||
          !hasExactObjectKeys(variant, ["name", "carrier"]) || typeof variant.name !== "string" || variant.name.length === 0 ||
          !isRustTargetTypeRef(variant.carrier)) ||
        new Set(definition.variants.map(variant => variant.name)).size !== definition.variants.length ||
        value.origin === "generated" && (definition.variants.length !== value.genericArguments.length ||
          definition.variants.some((variant, index) => {
            const argument = value.genericArguments[index];
            return variant.name !== `Variant${index}` || argument?.kind !== "type" ||
              !rustTargetTypeRefEquals(variant.carrier, argument.type);
          }))) return false;
      const key = closedMetadataKey(definition.carrier);
      const existing = definitions.get(key);
      const expected = sourceUnionVariants(definition.carrier);
      if (expected !== undefined && (expected.length !== definition.variants.length ||
        expected.some((variant, index) => variant.name !== definition.variants[index]!.name ||
          !rustTargetTypeRefEquals(variant.carrier, definition.variants[index]!.carrier)))) return false;
      if (template && templates.has(identity) && templates.get(identity) !== existing) return false;
      const normalized = existing ?? snapshotClosedMetadata(definition);
      definitions.set(key, normalized);
      if (template) templates.set(identity, normalized);
      return true;
    },
    seal() {
      const visit = (carrier: TargetTypeRef): void => {
        if (rustSourceUnionCarrierValue(carrier) !== undefined && sourceUnionVariants(carrier) === undefined) {
          throw new Error("A Rust source union references an undefined or incompatible variant contract.");
        }
        for (const child of rustTargetTypeChildren(carrier)) visit(child);
      };
      for (const definition of definitions.values()) for (const variant of definition.variants) visit(variant.carrier);
      sealed = true;
      return Object.freeze({sourceUnionVariants});
    },
  });
}

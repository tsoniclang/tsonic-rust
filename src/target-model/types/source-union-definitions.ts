import type { TargetTypeRef } from "./model.js";
import { rustSourceUnionCarrierValue, type RustSourceUnionVariantCarrierValue } from "./carriers/source-types.js";
import { inferRustTargetGenericBindings } from "./carriers/generic-inference.js";
import { rustTargetGenericReferences } from "./carriers/generic-references.js";
import { substituteRustTargetGenerics } from "./carriers/substitution.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../metadata/closed-data.js";

export interface RustSourceUnionDefinition {
  readonly carrier: TargetTypeRef;
  readonly variants: readonly RustSourceUnionVariantCarrierValue[];
}

export interface RustTypeDefinitions {
  sourceUnionVariants(carrier: TargetTypeRef): readonly RustSourceUnionVariantCarrierValue[] | undefined;
}

export const emptyRustTypeDefinitions: RustTypeDefinitions = Object.freeze({
  sourceUnionVariants: () => undefined,
});

export function rustSourceUnionDefinitionIdentity(carrier: TargetTypeRef): string | undefined {
  const value = rustSourceUnionCarrierValue(carrier);
  return value === undefined ? undefined : closedMetadataKey([value.origin, value.fileName, value.typeName]);
}

export function instantiateRustSourceUnionVariants(
  definition: RustSourceUnionDefinition,
  carrier: TargetTypeRef,
): readonly RustSourceUnionVariantCarrierValue[] | undefined {
  const identity = rustSourceUnionDefinitionIdentity(carrier);
  if (identity === undefined || identity !== rustSourceUnionDefinitionIdentity(definition.carrier)) return undefined;
  const references = rustTargetGenericReferences(definition.carrier);
  const bindings = inferRustTargetGenericBindings(definition.carrier, carrier, {
    typeNames: new Set(references.typeNames), lifetimeIdentities: new Set(references.lifetimeIdentities),
    constIdentities: new Set(),
  });
  if (bindings === undefined) return undefined;
  return snapshotClosedMetadata(definition.variants.map(variant => ({name: variant.name,
    carrier: substituteRustTargetGenerics(variant.carrier, bindings.types, bindings.lifetimes, bindings.consts),
  })));
}

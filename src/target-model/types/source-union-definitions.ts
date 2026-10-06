import type { TargetTypeRef } from "./model.js";
import { rustTsValueTargetType } from "./carriers/native.js";
import { rustSourceUnionCarrierValue, rustSourceUnionTargetType, type RustSourceUnionVariantCarrierValue } from "./carriers/source-types.js";
import { inferRustTargetGenericBindings } from "./carriers/generic-inference.js";
import { rustTargetGenericReferences } from "./carriers/generic-references.js";
import { substituteRustTargetGenerics } from "./carriers/substitution.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../metadata/closed-data.js";

export interface RustSourceUnionDefinition {
  readonly carrier: TargetTypeRef;
  readonly variants: readonly RustSourceUnionVariantCarrierValue[];
}

export interface RustTypeDefinitions {
  readonly closedValueCarrier: TargetTypeRef;
  sourceUnionVariants(carrier: TargetTypeRef): readonly RustSourceUnionVariantCarrierValue[] | undefined;
  programErrorOrigin(carrier: TargetTypeRef): RustProgramErrorOrigin | undefined;
}

export type RustProgramErrorOrigin =
  | { readonly kind: "provider" }
  | { readonly kind: "project"; readonly variant: string; readonly sourceError: boolean };

export const emptyRustTypeDefinitions: RustTypeDefinitions = Object.freeze({
  closedValueCarrier: Object.freeze(rustTsValueTargetType()),
  sourceUnionVariants: () => undefined,
  programErrorOrigin: () => undefined,
});

export function rustSourceUnionDefinitionIdentity(carrier: TargetTypeRef): string | undefined {
  const value = rustSourceUnionCarrierValue(carrier);
  return value === undefined ? undefined : closedMetadataKey([value.origin, value.fileName, value.typeName]);
}

export function rustGeneratedSourceUnionTemplate(definition: RustSourceUnionDefinition): RustSourceUnionDefinition | undefined {
  const value = rustSourceUnionCarrierValue(definition.carrier);
  const identity = rustSourceUnionDefinitionIdentity(definition.carrier);
  if (value?.origin !== "generated" || identity === undefined) return undefined;
  const parameters = definition.variants.map((_, index): TargetTypeRef => ({
    kind: "type-parameter", identity: `${identity}:payload:${index}`, name: `Payload${index}`,
  }));
  return snapshotClosedMetadata({
    carrier: rustSourceUnionTargetType(value.fileName, value.typeName,
      parameters.map(type => ({ kind: "type", type })), "generated"),
    variants: definition.variants.map((variant, index) => ({ name: variant.name, carrier: parameters[index]! })),
  });
}

export function instantiateRustSourceUnionVariants(
  definition: RustSourceUnionDefinition,
  carrier: TargetTypeRef,
): readonly RustSourceUnionVariantCarrierValue[] | undefined {
  const identity = rustSourceUnionDefinitionIdentity(carrier);
  if (identity === undefined || identity !== rustSourceUnionDefinitionIdentity(definition.carrier)) return undefined;
  const references = rustTargetGenericReferences(definition.carrier);
  const bindings = inferRustTargetGenericBindings(definition.carrier, carrier, {
    typeIdentities: new Set(references.typeIdentities), lifetimeIdentities: new Set(references.lifetimeIdentities),
    constIdentities: new Set(),
  });
  if (bindings === undefined) return undefined;
  return snapshotClosedMetadata(definition.variants.map(variant => ({name: variant.name,
    carrier: substituteRustTargetGenerics(variant.carrier, bindings.types, bindings.lifetimes, bindings.consts),
  })));
}

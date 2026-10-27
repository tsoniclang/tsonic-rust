import type { RustTargetGenericArgument, TargetTypeRef } from "./model.js";
import { rustTsValueTargetType } from "./carriers/native.js";
import { rustSourceUnionCarrierValue, rustSourceUnionTargetType, type RustSourceUnionVariantCarrierValue } from "./carriers/source-types.js";
import { inferRustTargetGenericBindings } from "./carriers/generic-inference.js";
import { rustTargetGenericReferences } from "./carriers/generic-references.js";
import { substituteRustTargetGenerics } from "./carriers/substitution.js";
import { closedMetadataKey, isDenseDataArray, snapshotClosedMetadata } from "../metadata/closed-data.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "./equality.js";

import type { RustNativeEnumDeclaration } from "../records/native/native-value-declarations.js";

export interface RustSourceUnionDefinition {
  readonly carrier: TargetTypeRef;
  readonly variants: readonly RustSourceUnionVariantCarrierValue[];
}

export interface RustSourceUnionPayloadTemplate extends RustSourceUnionDefinition {
  readonly sourceArgumentIndexes: readonly number[];
  readonly payloadParameters: readonly {
    readonly variantIndex: number;
    readonly parameter: Extract<TargetTypeRef, { readonly kind: "type-parameter" }>;
  }[];
}

export interface RustTypeDefinitions {
  readonly closedValueCarrier: TargetTypeRef;
  sourceEnumDefinition(carrier: TargetTypeRef): RustNativeEnumDeclaration | undefined;
  sourceUnionVariants(carrier: TargetTypeRef): readonly RustSourceUnionVariantCarrierValue[] | undefined;
  sourceUnionPayloadTemplate(carrier: TargetTypeRef): RustSourceUnionPayloadTemplate | undefined;
  programErrorOrigin(carrier: TargetTypeRef): RustProgramErrorOrigin | undefined;
}

export type RustProgramErrorOrigin =
  | { readonly kind: "provider" }
  | { readonly kind: "project"; readonly variant: string; readonly sourceError: boolean };

export const emptyRustTypeDefinitions: RustTypeDefinitions = Object.freeze({
  closedValueCarrier: Object.freeze(rustTsValueTargetType()),
  sourceEnumDefinition: () => undefined,
  sourceUnionVariants: () => undefined,
  sourceUnionPayloadTemplate: () => undefined,
  programErrorOrigin: () => undefined,
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
  const value = rustSourceUnionCarrierValue(carrier)!;
  if (value.origin === "generated") {
    const selection = value.payloads;
    return selection.kind !== "physical" || selection.types.length !== definition.variants.length ? undefined
      : snapshotClosedMetadata(definition.variants.map((variant, index) => ({ name: variant.name,
        carrier: selection.types[index]! })));
  }
  const logical = rustSourceUnionTargetType(value.fileName, value.typeName, value.genericArguments);
  const references = rustTargetGenericReferences(definition.carrier);
  const bindings = inferRustTargetGenericBindings(definition.carrier, logical, {
    typeIdentities: new Set(references.typeIdentities), lifetimeIdentities: new Set(references.lifetimeIdentities),
    constIdentities: new Set(),
  });
  if (bindings === undefined) return undefined;
  return snapshotClosedMetadata(definition.variants.map(variant => ({name: variant.name,
    carrier: substituteRustTargetGenerics(variant.carrier, bindings.types, bindings.lifetimes, bindings.consts),
  })));
}

export function instantiateRustSourceUnionPayloads(
  carrier: TargetTypeRef,
  payloads: readonly TargetTypeRef[],
  definitions: RustTypeDefinitions,
): TargetTypeRef | undefined {
  const value = rustSourceUnionCarrierValue(carrier);
  const template = value === undefined ? undefined : definitions.sourceUnionPayloadTemplate(carrier);
  const variants = value === undefined ? undefined : definitions.sourceUnionVariants(carrier);
  if (value === undefined || template === undefined || variants === undefined || !isDenseDataArray(payloads) ||
    payloads.length !== variants.length || payloads.some(payload => !isRustTargetTypeRef(payload))) return undefined;
  const indexes = new Set(template.payloadParameters.map(parameter => parameter.variantIndex));
  if (variants.some((variant, index) => !indexes.has(index) && !rustTargetTypeRefEquals(variant.carrier, payloads[index]))) return undefined;
  return snapshotClosedMetadata(rustSourceUnionTargetType(value.fileName, value.typeName, value.genericArguments,
    value.origin, { kind: "physical", types: payloads }));
}

export function rustSourceUnionPayloadArguments(
  carrier: TargetTypeRef,
  definitions: RustTypeDefinitions,
): readonly RustTargetGenericArgument[] | undefined {
  const value = rustSourceUnionCarrierValue(carrier);
  const template = value === undefined ? undefined : definitions.sourceUnionPayloadTemplate(carrier);
  const variants = value === undefined ? undefined : definitions.sourceUnionVariants(carrier);
  if (value === undefined || template === undefined || variants === undefined) return undefined;
  const sourceArguments = template.sourceArgumentIndexes.map(index => value.genericArguments[index]);
  if (sourceArguments.some(argument => argument === undefined)) return undefined;
  return snapshotClosedMetadata([...(sourceArguments as readonly RustTargetGenericArgument[]),
    ...template.payloadParameters.map(parameter => ({ kind: "type" as const, type: variants[parameter.variantIndex]!.carrier }))]);
}

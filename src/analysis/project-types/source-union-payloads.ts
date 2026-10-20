import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustSourceUnionCarrierValue } from "../../target-model/types/carriers/source-types.js";

import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";

import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

import { rustSourceUnionDefinitionIdentity, type RustSourceUnionDefinition, type RustSourceUnionPayloadTemplate, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
export function createRustSourceUnionPayloadTemplate(
  definition: RustSourceUnionDefinition,
  variantsFor: RustTypeDefinitions["sourceUnionVariants"],
): RustSourceUnionPayloadTemplate | undefined {
  const value = rustSourceUnionCarrierValue(definition.carrier);
  const identity = rustSourceUnionDefinitionIdentity(definition.carrier);
  if (value === undefined || identity === undefined) return undefined;
  const recursive = definition.variants.map(variant => value.origin === "generated" ? false
    : reachesSourceUnion(variant.carrier, identity, variantsFor));
  if (recursive.some(result => result === undefined)) return undefined;
  const references = rustTargetGenericReferences({ kind: "tuple", elements: definition.variants
    .filter((_, index) => recursive[index]).map(variant => variant.carrier) });
  const sourceArgumentIndexes = value.genericArguments.flatMap((argument, index) => {
    const selected = argument.kind === "type" ? argument.type.kind === "type-parameter" &&
      references.typeIdentities.includes(argument.type.identity)
      : argument.kind === "lifetime" ? references.lifetimeIdentities.includes(rustLifetimeKey(argument.lifetime))
      : argument.value.kind === "parameter" && references.constIdentities.includes(argument.value.identity);
    return selected ? [index] : [];
  });
  const names = new Set(rustTargetGenericReferences(definition.carrier).typeParameters.map(parameter => parameter.name));
  const payloadParameters = definition.variants.flatMap((_, variantIndex) => recursive[variantIndex] ? [] : [{
    variantIndex, parameter: { kind: "type-parameter" as const, identity: `${identity}:payload:${variantIndex}`,
      name: allocateRustGeneratedName(names, `Payload${variantIndex}`) },
  }]);
  const parametersByIndex = new Map(payloadParameters.map(selected => [selected.variantIndex, selected.parameter]));
  return snapshotClosedMetadata({
    carrier: definition.carrier, sourceArgumentIndexes, payloadParameters,
    variants: definition.variants.map((variant, index) => ({ name: variant.name,
      carrier: parametersByIndex.get(index) ?? variant.carrier })),
  });
}

function reachesSourceUnion(
  carrier: TargetTypeRef,
  identity: string,
  variantsFor: RustTypeDefinitions["sourceUnionVariants"],
): boolean | undefined {
  let remaining = 4096;
  const visit = (type: TargetTypeRef, ancestors: ReadonlySet<string>, depth: number): boolean | undefined => {
    if (--remaining < 0 || depth > 128) return undefined;
    const owner = rustSourceUnionDefinitionIdentity(type);
    if (owner === identity) return true;
    const children = [...rustTargetTypeChildren(type)];
    if (owner !== undefined && !ancestors.has(owner)) {
      const variants = variantsFor(type);
      if (variants === undefined) return undefined;
      children.push(...variants.map(variant => variant.carrier));
    }
    const next = owner === undefined ? ancestors : new Set([...ancestors, owner]);
    for (const child of children) {
      const recursive = visit(child, next, depth + 1);
      if (recursive !== false) return recursive;
    }
    return false;
  };
  return visit(carrier, new Set(), 0);
}

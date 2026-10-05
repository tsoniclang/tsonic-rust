import type { Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceTypeCarrierValue, rustSourceUnionTargetType, rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { rustSourceUnionMemberDeclarationIsOwned } from "../../evidence/source-union-members.js";
import type { RustSourceUnionVariant } from "../source-type-registry.js";
import { rustSourceUnionMemberTypes } from "./source-unions.js";

export function resolveRustInferredUnion(
  sourceType: Type,
  members: readonly Type[],
  carriers: readonly TargetTypeRef[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (members.length < 2 || members.length !== carriers.length) return undefined;
  if (!context.source.navigation.isProjectDeclaration(context.currentSourceFile)) return undefined;
  return resolveRustSelectedUnion(sourceType, carriers.map((carrier, index) => ({
    carrier, sourceTypes: [members[index]!],
  })), context, options);
}

export function resolveRustSelectedUnion(
  sourceType: Type,
  members: readonly Pick<RustSourceUnionVariant, "carrier" | "sourceTypes">[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (members.length < 2 || members.length > 4096 ||
    !context.source.navigation.isProjectDeclaration(context.currentSourceFile) ||
    members.some(member => member.sourceTypes.length === 0 || member.sourceTypes.some(type => type === undefined))) return undefined;
  const flattened = flattenSelectedUnionMembers(members, options);
  if (flattened === undefined) return undefined;
  const arms = flattened.map(({ carrier, sourceTypes }) => {
    const memberTypes = rustSourceUnionMemberTypes(sourceTypes, context.currentSemantics);
    if (memberTypes === undefined) return undefined;
    const value = rustSourceTypeCarrierValue(carrier);
    const shape = options.sourceTypes.structuralObjectForType(sourceTypes[0]!, carrier);
    const ownerFileName = value?.fileName ?? rustStructuralObjectCarrierValue(carrier)?.ownerFileName ??
      context.ast.getFileName(context.currentSourceFile);
    if (ownerFileName === undefined) return undefined;
    return { carrier, sourceTypes: memberTypes, shape, ownerFileName, identity: closedMetadataKey(carrier) };
  });
  if (arms.some(arm => arm === undefined)) return undefined;
  const sorted = arms.filter(arm => arm !== undefined).sort((left, right) => left.identity.localeCompare(right.identity, "en"));
  const distinct = sorted.filter((arm, index) => sorted.findIndex(candidate => candidate.identity === arm.identity) === index);
  const variants = distinct.map((arm, index) => ({ name: `Variant${index}`,
    sourceTypes: Object.freeze([...new Set(sorted.filter(candidate => candidate.identity === arm.identity).flatMap(candidate => candidate.sourceTypes))]),
    carrier: arm.carrier, ...(arm.shape === undefined ? {} : { shape: arm.shape }) }));
  const carrier = options.sourceTypes.generatedUnionCarrierForVariants(variants.map(variant => variant.carrier)) ?? rustSourceUnionTargetType(
    sorted[0]!.ownerFileName,
    `Union${variants.length}`,
    variants.map(variant => ({ kind: "type", type: variant.carrier })),
    "generated",
  );
  const semantics = context.currentSemantics;
  const selectedProperties = semantics.types.propertyInfos(sourceType).map(property => ({
    symbol: property.symbol,
    declarations: Object.freeze([...new Set([
      ...semantics.declarations.symbolDeclarations(property.symbol),
      ...property.rootSymbols.flatMap(symbol => semantics.declarations.symbolDeclarations(symbol)),
    ])]),
  }));
  if (selectedProperties.some(property => property.declarations.length === 0 ||
    property.declarations.some(declaration => !rustSourceUnionMemberDeclarationIsOwned(declaration, context, options)))) return undefined;
  return options.sourceTypes.registerSourceUnion({ sourceType, carrier, variants, selectedProperties }) ? carrier : undefined;
}

function flattenSelectedUnionMembers(
  members: readonly Pick<RustSourceUnionVariant, "carrier" | "sourceTypes">[],
  options: RustTargetTypeResolutionOptions,
): readonly Pick<RustSourceUnionVariant, "carrier" | "sourceTypes">[] | undefined {
  const result: Pick<RustSourceUnionVariant, "carrier" | "sourceTypes">[] = [];
  let rows = 0;
  let sources = 0;
  const visit = (member: Pick<RustSourceUnionVariant, "carrier" | "sourceTypes">, ancestors: readonly string[]): boolean => {
    if (++rows > 4096 || ancestors.length > 128) return false;
    const key = closedMetadataKey(member.carrier);
    if (ancestors.includes(key)) return false;
    const union = options.sourceTypes.sourceUnionForCarrier(member.carrier);
    if (union === undefined) {
      sources += member.sourceTypes.length;
      if (sources > 4096) return false;
      result.push(member);
      return true;
    }
    return union.variants.length > 0 && union.variants.every(variant => visit(variant, [...ancestors, key]));
  };
  return members.every(member => visit(member, [])) ? result : undefined;
}

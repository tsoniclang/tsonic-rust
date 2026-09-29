import type { Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceTypeCarrierValue, rustSourceUnionTargetType, rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { rustSourceUnionMemberDeclarationIsOwned } from "../../evidence/source-union-members.js";

export function resolveRustInferredUnion(
  sourceType: Type,
  members: readonly Type[],
  carriers: readonly TargetTypeRef[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (members.length < 2 || members.length !== carriers.length) return undefined;
  if (!context.source.navigation.isProjectDeclaration(context.currentSourceFile)) return undefined;
  const alias = context.currentSemantics.declarations.typeAliasSymbol(sourceType);
  if (alias !== undefined && context.currentSemantics.declarations.symbolDeclarations(alias).some(declaration =>
    context.ast.kindName(declaration) === "KindTypeAliasDeclaration" &&
    context.source.navigation.isProjectDeclaration(declaration))) return undefined;
  const arms = carriers.map((carrier, index) => {
    const value = rustSourceTypeCarrierValue(carrier);
    const sourceType = members[index]!;
    const shape = options.sourceTypes.structuralObjectForType(sourceType, carrier);
    const ownerFileName = value?.fileName ?? rustStructuralObjectCarrierValue(carrier)?.ownerFileName ??
      context.ast.getFileName(context.currentSourceFile);
    if (ownerFileName === undefined) return undefined;
    return { carrier, sourceType, shape, ownerFileName, identity: closedMetadataKey(carrier) };
  });
  if (arms.some(arm => arm === undefined)) return undefined;
  const sorted = arms.filter(arm => arm !== undefined).sort((left, right) => left.identity.localeCompare(right.identity, "en"));
  const distinct = sorted.filter((arm, index) => sorted.findIndex(candidate => candidate.identity === arm.identity) === index);
  const variants = distinct.map((arm, index) => ({ name: `Variant${index}`,
    sourceTypes: Object.freeze([...new Set(sorted.filter(candidate => candidate.identity === arm.identity).map(candidate => candidate.sourceType))]),
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

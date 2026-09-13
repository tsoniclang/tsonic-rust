import type { Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceTypeCarrierValue, rustSourceUnionTargetType } from "../../../target-model/types/carriers/source-types.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";

export function resolveRustInferredClassUnion(
  sourceType: Type,
  members: readonly Type[],
  carriers: readonly TargetTypeRef[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (members.length < 2 || members.length !== carriers.length) return undefined;
  const arms = carriers.map((carrier, index) => {
    const value = rustSourceTypeCarrierValue(carrier);
    const declaration = options.sourceTypes.declarationForCarrier(carrier);
    if (value?.shape !== "object" || declaration === undefined ||
      context.ast.kindName(declaration) !== "KindClassDeclaration" ||
      !context.source.navigation.isProjectDeclaration(declaration)) return undefined;
    return { carrier, sourceType: members[index]!, value, identity: JSON.stringify([value.fileName, value.typeName]) };
  });
  if (arms.some(arm => arm === undefined)) return undefined;
  const sorted = arms.filter(arm => arm !== undefined).sort((left, right) => left.identity.localeCompare(right.identity, "en"));
  if (new Set(sorted.map(arm => arm.identity)).size !== sorted.length) return undefined;
  const variants = sorted.map((arm, index) => ({ name: `Variant${index}`, sourceType: arm.sourceType, carrier: arm.carrier }));
  const carrier = rustSourceUnionTargetType(
    sorted[0]!.value.fileName,
    `Union${variants.length}`,
    variants.map(variant => ({ name: variant.name, carrier: variant.carrier })),
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
    property.declarations.some(declaration => !context.source.navigation.isProjectDeclaration(declaration)))) return undefined;
  return options.sourceTypes.registerSourceUnion({ sourceType, carrier, variants, selectedProperties }) ? carrier : undefined;
}

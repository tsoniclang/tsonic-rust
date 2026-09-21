import type { Type } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceTypeCarrierValue, rustSourceUnionTargetType, rustStructuralObjectCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { isRustNumberArrayPayload } from "../../../target-model/types/carriers/array-unions.js";
import { rustSourceUnionMemberDeclarationIsOwned } from "../../evidence/source-union-members.js";

export function resolveRustInferredObjectUnion(
  sourceType: Type,
  members: readonly Type[],
  carriers: readonly TargetTypeRef[],
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  if (members.length < 2 || members.length !== carriers.length) return undefined;
  const numberArrayUnion = options.jsEnabled && carriers.every(isRustNumberArrayPayload);
  const alias = context.currentSemantics.declarations.typeAliasSymbol(sourceType);
  if (alias !== undefined && context.currentSemantics.declarations.symbolDeclarations(alias).some(declaration =>
    context.ast.kindName(declaration) === "KindTypeAliasDeclaration" &&
    context.source.navigation.isProjectDeclaration(declaration))) return undefined;
  const arms = carriers.map((carrier, index) => {
    const value = rustSourceTypeCarrierValue(carrier);
    const declaration = options.sourceTypes.declarationForCarrier(carrier);
    const sourceType = members[index]!;
    const shape = options.sourceTypes.structuralObjectForType(sourceType, carrier);
    const kind = declaration === undefined ? undefined : context.ast.kindName(declaration);
    const projectObject = value?.shape === "object" && declaration !== undefined &&
      (kind === "KindClassDeclaration" || kind === "KindInterfaceDeclaration") &&
      context.source.navigation.isProjectDeclaration(declaration);
    if (!projectObject && shape === undefined && !numberArrayUnion) return undefined;
    const ownerFileName = value?.fileName ?? rustStructuralObjectCarrierValue(carrier)?.ownerFileName ??
      (numberArrayUnion ? context.ast.getFileName(context.currentSourceFile) : undefined);
    if (ownerFileName === undefined) return undefined;
    return { carrier, sourceType, shape, ownerFileName, identity: closedMetadataKey(carrier) };
  });
  if (arms.some(arm => arm === undefined)) return undefined;
  const sorted = arms.filter(arm => arm !== undefined).sort((left, right) => left.identity.localeCompare(right.identity, "en"));
  if (new Set(sorted.map(arm => arm.identity)).size !== sorted.length) return undefined;
  const variants = sorted.map((arm, index) => ({ name: `Variant${index}`, sourceType: arm.sourceType,
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

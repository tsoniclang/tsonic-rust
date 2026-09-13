import type { Node, Type } from "@tsonic/tsts";
import type { RustSourceUnion } from "../source-type-registry.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetType } from "./target.js";

export function retainRustSourceUnionInstantiation(
  sourceType: Type,
  template: RustSourceUnion,
  carrier: TargetTypeRef,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const existing = options.sourceTypes.sourceUnionForCarrier(carrier);
  if (existing !== undefined && options.sourceTypes.sourceUnionVariantIndexesForTypes(carrier, [sourceType]) !== undefined) return carrier;
  const value = rustSourceUnionCarrierValue(carrier);
  const semantics = context.currentSemantics;
  if (value === undefined || !semantics.types.isUnion(sourceType)) return undefined;
  const members = semantics.types.unionOrIntersectionTypes(sourceType);
  if (members.length !== template.variants.length || members.some(member => member === undefined)) return undefined;
  const parameters = context.sourceLifetimes.contractFor(template.declaration)?.parameters ?? [];
  if (parameters.length !== value.genericArguments.length) return undefined;
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  for (const [index, parameter] of parameters.entries()) {
    const argument = value.genericArguments[index];
    if (argument?.kind !== parameter.kind) return undefined;
    if (parameter.kind === "type" && argument.kind === "type") {
      substitutions.set(parameter.declaration, argument.type);
    }
  }
  const instantiatedContext = { ...context, sourceTypeParameterSubstitutions: substitutions };
  const selected = members.map(member => ({
    sourceType: member,
    carrier: resolveRustTargetType(member, instantiatedContext, options, resolving),
  }));
  if (selected.some(member => member.carrier === undefined)) return undefined;
  const used = new Set<Type>();
  const variants = template.variants.map((variant, index) => {
    const expected = value.variants[index];
    const origin = sourceDeclarations(variant.sourceType, context);
    const matches = selected.filter(member => {
      if (!rustTargetTypeRefEquals(expected?.carrier, member.carrier)) return false;
      if (variant.sourceType === member.sourceType) return true;
      const declarations = sourceDeclarations(member.sourceType, context);
      return origin.length !== 0 && declarations.length === origin.length &&
        declarations.every(declaration => origin.includes(declaration));
    });
    if (matches.length !== 1 || used.has(matches[0]!.sourceType)) return undefined;
    const selectedMember = matches[0]!;
    used.add(selectedMember.sourceType);
    const shape = options.sourceTypes.structuralObjectForType(selectedMember.sourceType, selectedMember.carrier);
    return {
      name: variant.name,
      sourceType: selectedMember.sourceType,
      carrier: selectedMember.carrier!,
      ...(shape === undefined ? {} : { shape }),
    };
  });
  if (variants.some(variant => variant === undefined)) return undefined;
  const selectedProperties = semantics.types.propertyInfos(sourceType).map(property => ({
    symbol: property.symbol,
    declarations: Object.freeze([...new Set([
      ...semantics.declarations.symbolDeclarations(property.symbol),
      ...property.rootSymbols.flatMap(symbol => semantics.declarations.symbolDeclarations(symbol)),
    ])]),
  }));
  if (selectedProperties.some(property => property.declarations.length === 0 ||
    property.declarations.some(declaration => !context.source.navigation.isProjectDeclaration(declaration)))) {
    return undefined;
  }
  return options.sourceTypes.registerSourceUnion({
    declaration: template.declaration,
    sourceType,
    carrier,
    variants: variants as RustSourceUnion["variants"],
    selectedProperties,
  }) ? carrier : undefined;
}

function sourceDeclarations(type: Type, context: RustTargetTypeResolutionContext): readonly Node[] {
  const declarations = context.currentSemantics.declarations;
  const symbol = declarations.typeSymbol(type);
  return symbol === undefined ? [] : declarations.symbolDeclarations(symbol);
}

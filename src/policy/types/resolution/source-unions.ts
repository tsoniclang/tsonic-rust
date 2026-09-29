import type { Node, Type } from "@tsonic/tsts";
import type { RustSourceUnion } from "../source-type-registry.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { resolveRustTargetType } from "./target.js";
import { rustSourceUnionMemberDeclarationIsOwned } from "../../evidence/source-union-members.js";
import {
  isRustAbsenceCarrier,
  isRustUnitCarrier,
  rustAbsenceTargetType,
  isRustBigIntCarrier,
  rustJsNumericTargetType,
  rustJsStringNumberTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";
import { rustSourceOptionalTargetType } from "../../../target-model/types/projections.js";

export function resolveRustUnionValueCarrier(
  values: readonly TargetTypeRef[],
  options: RustTargetTypeResolutionOptions,
  resolveInferred: () => TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (options.jsEnabled && values.length === 2 &&
    values.some(carrier => rustTargetTypeRefEquals(carrier, rustSourcePrimitiveTargetType("float64")))) {
    if (values.some(carrier => rustTargetTypeRefEquals(carrier, rustStringTargetType()))) {
      return rustJsStringNumberTargetType();
    }
    if (values.some(isRustBigIntCarrier)) return rustJsNumericTargetType();
  }
  const common = options.resolveProjectUnionCarrier(values);
  return common !== undefined && values.some(carrier => rustTargetTypeRefEquals(carrier, common))
    ? common
    : resolveInferred() ?? common;
}

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
  const expectedVariants = options.sourceTypes.sourceUnionVariants(carrier);
  const semantics = context.currentSemantics;
  if (value === undefined || expectedVariants === undefined || template.declaration === undefined || !semantics.types.isUnion(sourceType)) return undefined;
  const members = semantics.types.unionOrIntersectionTypes(sourceType);
  if (members.length !== template.variants.reduce((count, variant) => count + variant.sourceTypes.length, 0) ||
    members.some(member => member === undefined)) return undefined;
  const parameters = context.sourceLifetimes.contractFor(template.declaration)?.parameters ?? [];
  if (parameters.length !== value.genericArguments.length) return undefined;
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  const application = semantics.types.aliasApplication(sourceType);
  for (const [index, parameter] of parameters.entries()) {
    const argument = value.genericArguments[index];
    if (argument?.kind !== parameter.kind) return undefined;
    if (parameter.kind === "type" && argument.kind === "type") {
      const binding = application?.bindings.find(binding => binding.declaration === parameter.declaration);
      if (binding === undefined) return undefined;
      substitutions.set(parameter.declaration, { sourceType: binding.argument, carrier: argument.type });
    }
  }
  const instantiatedContext = { ...context, sourceTypeParameterSubstitutions: substitutions };
  const alreadyResolving = resolving.has(sourceType);
  resolving.add(sourceType);
  try {
    const selected = members.map(member => ({
      sourceType: member,
      carrier: resolveRustTargetType(member, instantiatedContext, options, resolving),
    }));
    if (selected.some(member => member.carrier === undefined)) return undefined;
    const used = new Set<Type>();
    const variants = template.variants.map((variant, index) => {
      const expected = expectedVariants[index];
      const matches = selected.filter(member => {
        if (!rustTargetTypeRefEquals(expected?.carrier, member.carrier)) return false;
        if (variant.sourceTypes.includes(member.sourceType)) return true;
        const declarations = sourceDeclarations(member.sourceType, context);
        return variant.sourceTypes.some(type => {
          const origin = sourceDeclarations(type, context);
          return origin.length !== 0 && declarations.length === origin.length &&
            declarations.every(declaration => origin.includes(declaration));
        });
      });
      if (matches.length !== variant.sourceTypes.length || matches.some(member => used.has(member.sourceType))) return undefined;
      const selectedMember = matches[0]!;
      matches.forEach(member => used.add(member.sourceType));
      const shape = options.sourceTypes.structuralObjectForType(selectedMember.sourceType, selectedMember.carrier);
      return {
        name: variant.name,
        sourceTypes: Object.freeze(matches.map(member => member.sourceType)),
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
      property.declarations.some(declaration => !rustSourceUnionMemberDeclarationIsOwned(declaration, context, options)))) {
      return undefined;
    }
    return options.sourceTypes.registerSourceUnion({
      declaration: template.declaration,
      sourceType,
      carrier,
      variants: variants as RustSourceUnion["variants"],
      selectedProperties,
    }) ? carrier : undefined;
  } finally {
    if (!alreadyResolving) resolving.delete(sourceType);
  }
}

function sourceDeclarations(type: Type, context: RustTargetTypeResolutionContext): readonly Node[] {
  const declarations = context.currentSemantics.declarations;
  const symbol = declarations.typeSymbol(type);
  return symbol === undefined ? [] : declarations.symbolDeclarations(symbol);
}

export function resolveRustSourceUnionCarrier(
  members: readonly TargetTypeRef[],
  resolveValues: (values: readonly TargetTypeRef[]) => TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const hasValue = members.some(member => !isRustUnitCarrier(member));
  const values = members.filter((member) => !isRustAbsenceCarrier(member) && !(hasValue && isRustUnitCarrier(member)));
  const distinct = values.filter((value, index) =>
    values.findIndex((candidate) => rustTargetTypeRefEquals(candidate, value)) === index);
  const absent = values.length !== members.length;
  if (distinct.length === 0) return absent ? rustAbsenceTargetType() : undefined;
  const value = distinct.length === 1 ? distinct[0] : resolveValues(distinct);
  return value === undefined || !absent ? value : rustSourceOptionalTargetType(value);
}

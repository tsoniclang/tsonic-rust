import type { Node, Type } from "@tsonic/tsts";
import { sourceBoundTypeRelationship, type SourceFileSemantics } from "@tsonic/target-api/source";
import type { RustSourceUnion } from "../source-type-registry.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
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
import { retainRustStructuralInstantiation } from "./structural-instantiations.js";
import { rustGenericCallableSignaturesMatch } from "../../../target-model/conversions/generic-callable.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";

export function rustSourceUnionValueTypes(
  members: readonly Type[],
  semantics: SourceFileSemantics,
): readonly Type[] {
  const hasValue = members.some(member => !semantics.types.isNullish(member) && !semantics.types.isVoidLike(member));
  return members.filter(member => !semantics.types.isNullish(member) && !(hasValue && semantics.types.isVoidLike(member)));
}

export function rustSourceUnionMemberTypes(
  members: readonly Type[],
  semantics: SourceFileSemantics,
): readonly Type[] | undefined {
  if (members.length > 4096) return undefined;
  const result: Type[] = [];
  const retained = new Set<Type>();
  let rows = 0;
  for (const member of members) {
    if (member === undefined) return undefined;
    const selected = semantics.types.isUnion(member)
      ? rustSourceUnionValueTypes(semantics.types.unionOrIntersectionTypes(member), semantics) : [member];
    rows += selected.length;
    if (selected.length === 0 || rows > 4096 ||
      selected.some(type => type === undefined)) return undefined;
    for (const type of selected) if (!retained.has(type)) {
      retained.add(type);
      result.push(type);
    }
  }
  return result;
}

export function resolveRustUnionValueCarrier(
  values: readonly TargetTypeRef[],
  options: RustTargetTypeResolutionOptions,
  resolveInferred: () => TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const callable = values[0];
  if (callable !== undefined && values.every(value => rustGenericCallableSignaturesMatch(value, callable))) return callable;
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
  declaration?: Node,
): TargetTypeRef | undefined {
  const existing = options.sourceTypes.sourceUnionForCarrier(carrier);
  if (existing !== undefined && options.sourceTypes.sourceUnionVariantIndexesForTypes(carrier, [sourceType]) !== undefined) return carrier;
  const value = rustSourceUnionCarrierValue(carrier);
  const expectedVariants = options.sourceTypes.sourceUnionVariants(carrier);
  const semantics = context.currentSemantics;
  if (value === undefined || expectedVariants === undefined || expectedVariants.length !== template.variants.length ||
    template.declaration !== undefined && template.declaration !== declaration ||
    !context.source.navigation.isProjectDeclaration(declaration ?? context.currentSourceFile) ||
    !semantics.types.isUnion(sourceType)) return undefined;
  const members = rustSourceUnionValueTypes(semantics.types.unionOrIntersectionTypes(sourceType), semantics);
  const templateMembers = template.variants.map(variant => rustSourceUnionMemberTypes(variant.sourceTypes, semantics));
  if (templateMembers.some(member => member === undefined) ||
    members.length !== templateMembers.reduce((count, selected) => count + (selected?.length ?? 0), 0) ||
    members.some(member => member === undefined)) return undefined;
  const substitutions = new Map(context.sourceTypeParameterSubstitutions);
  const parameters = declaration === undefined ? [] : context.sourceLifetimes.contractFor(declaration)?.parameters ?? [];
  const references = rustTargetGenericReferences(template.carrier);
  const nativeBindings = inferRustTargetGenericBindings(template.carrier, carrier, {
    typeIdentities: new Set(references.typeIdentities),
    lifetimeIdentities: new Set(references.lifetimeIdentities),
    constIdentities: new Set(),
  });
  if (nativeBindings === undefined) return undefined;
  const application = semantics.types.aliasApplication(sourceType);
  for (const parameter of parameters) {
    if (parameter.kind === "type") {
      const binding = application?.bindings.find(binding => binding.declaration === parameter.declaration);
      const selected = substitutions.get(parameter.declaration);
      const argument = nativeBindings.types.get(parameter.identity);
      if (binding === undefined || argument === undefined || selected !== undefined &&
        (selected.sourceType !== binding.argument || !rustTargetTypeRefEquals(selected.carrier, argument))) return undefined;
      substitutions.set(parameter.declaration, { sourceType: binding.argument, carrier: argument });
    }
  }
  const used = new Set<Type>();
  const instantiatedContext = { ...context, sourceTypeParameterSubstitutions: substitutions };
  const variants = template.variants.map((variant, index) => {
    const expected = expectedVariants[index];
    if (expected === undefined || expected.name !== variant.name) return undefined;
    const sources = templateMembers[index];
    if (sources === undefined) return undefined;
    const matches = members.filter(member => sources.some(type =>
      sourceBoundTypeRelationship(type, member, semantics,
        declaration => substitutions.get(declaration)?.sourceType) !== undefined));
    if (matches.length !== sources.length || matches.some(member => used.has(member))) return undefined;
    const selectedMember = matches[0]!;
    if (!retainRustStructuralInstantiation(selectedMember, variant.carrier, expected.carrier,
      instantiatedContext, options, new Set([sourceType]))) return undefined;
    matches.forEach(member => used.add(member));
    const shape = options.sourceTypes.structuralObjectForType(selectedMember, expected.carrier);
    return {
      name: variant.name,
      sourceTypes: Object.freeze(matches),
      carrier: expected.carrier,
      ...(shape === undefined ? {} : { shape }),
    };
  });
  if (variants.some(variant => variant === undefined) || used.size !== members.length) return undefined;
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

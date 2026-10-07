import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustOptionElementCarrier,
  rustSourceOptionalTargetType,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import type { Node, Symbol, Type } from "@tsonic/tsts";
import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { retainRustSourceUnionInstantiation } from "./source-unions.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetGenericArgument } from "../../../target-model/types/model.js";
import { rustProjectGenericParameters } from "../project-generic-contract.js";
import { resolveRustTargetType, resolveStructuralObjectType } from "./target.js";
import { retainRustStructuralInstantiation } from "./structural-instantiations.js";
import { rustTypeFamilyNormalizer } from "../type-family-normalization.js";
import { rustClassConstructorTargetType } from "../../../target-model/types/carriers/class-constructors.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { Node_Type, sourceCallableInterface } from "@tsonic/target-api/source";
import { resolveCallableType } from "./callables.js";
import { bindRustSourceDeclarationArguments, resolveRustSelectedTypeArguments, resolveRustSourceDeclarationArguments } from "./generic-arguments.js";
import { rustGenericCallableSignaturesMatch } from "../../../target-model/conversions/generic-callable.js";
import { resolveRustAuthoredTargetType } from "./tuples.js";

export interface RustResolvedProjectGenericArguments {
  readonly values: readonly RustTargetGenericArgument[];
}

export function resolveProjectSourceCarrier(
  symbol: Symbol | undefined,
  genericArguments: RustResolvedProjectGenericArguments,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  selectedDeclaration?: Node,
  selectedType?: Type,
  resolving: Set<object> = new Set(),
  referenceOnly = false,
): TargetTypeRef | undefined {
  const symbolDeclarations = symbol === undefined
    ? []
    : denseDefined(context.currentSemantics.declarations.symbolDeclarations(symbol));
  if (symbolDeclarations === undefined) {
    return undefined;
  }
  if (selectedType !== undefined && symbol !== undefined &&
    !context.currentSemantics.types.isTypeReference(selectedType) && symbolDeclarations.some(declaration =>
      context.ast.is.IsClassDeclaration(declaration) || context.ast.is.IsClassExpression(declaration) || context.ast.is.IsInterfaceDeclaration(declaration))) {
    const apparent = context.currentSemantics.types.apparentType(selectedType);
    if (apparent !== undefined && apparent !== selectedType && context.currentSemantics.declarations.typeSymbol(apparent) === symbol) {
      const arguments_ = resolveRustSelectedTypeArguments(apparent, context, options, resolving);
      if (arguments_ === undefined) return undefined;
      return resolveProjectSourceCarrier(
        symbol,
        { values: Object.freeze((arguments_ as readonly TargetTypeRef[]).map(type =>
          Object.freeze({ kind: "type" as const, type }))) },
        context, options, selectedDeclaration, apparent, resolving, true,
      );
    }
  }
  const declarations = selectedDeclaration === undefined
    ? symbolDeclarations
    : [
        selectedDeclaration,
        ...symbolDeclarations.filter((declaration) => declaration !== selectedDeclaration),
      ];
  for (const declaration of declarations) {
    if (!context.source.navigation.isProjectDeclaration(declaration)) continue;
    if (context.ast.is.IsInterfaceDeclaration(declaration) && selectedType !== undefined &&
      sourceCallableInterface(selectedType, context.currentSemantics, context.ast) !== undefined) {
      const selectedContext = bindRustSourceDeclarationArguments(
        declaration, selectedType, genericArguments.values, context,
      );
      return selectedContext === undefined ? undefined
        : resolveProjectCallableInterface(declaration, selectedType, selectedContext, options, resolving);
    }
    const carrier = options.sourceTypes.carrierForDeclaration(declaration, context.ast);
    if (carrier === undefined && context.ast.is.IsTypeAliasDeclaration(declaration)) {
      const typeNode = Node_Type(context.ast, declaration);
      const instance = selectedType ?? context.semanticsFor(declaration).declarations.declaredType(declaration);
      const selectedContext = instance === undefined ? undefined : bindRustSourceDeclarationArguments(
        declaration, instance, genericArguments.values, context,
      );
      if (typeNode === undefined || selectedContext === undefined) return undefined;
      return resolveRustAuthoredTargetType(typeNode, selectedContext, options, resolving);
    }
    if (selectedType !== undefined && (context.ast.is.IsClassDeclaration(declaration) || context.ast.is.IsClassExpression(declaration))) {
      const signatures = context.currentSemantics.types.signatureInfos(selectedType, "construct");
      if (signatures.length > 0) {
        const instances = signatures.map(signature => {
          const result = signature.returnType;
          return result === undefined ? undefined : resolveRustTargetType(result, context, options, resolving);
        });
        const instance = instances[0];
        const parameters = rustProjectGenericParameters(declaration, context);
        const own = new Set((context.sourceLifetimes.contractFor(declaration)?.parameters ?? []).map(parameter => parameter.declaration));
        const arguments_ = rustSourceTypeCarrierValue(instance)?.genericArguments;
        if (instance === undefined || parameters === undefined || arguments_ === undefined || parameters.length !== arguments_.length ||
          instances.some(candidate => !rustTargetTypeRefEquals(candidate, instance))) return undefined;
        const bound = parameters.flatMap((parameter, index) => {
          const argument = arguments_[index]!;
          const open = parameter.kind === "type" ? argument.kind === "type" && argument.type.kind === "type-parameter" && argument.type.identity === parameter.identity
            : argument.kind === "lifetime" && rustLifetimeKey(argument.lifetime) === rustLifetimeKey(parameter.lifetime);
          return own.has(parameter.declaration) && open ? [index] : [];
        });
        return rustClassConstructorTargetType(instance, bound);
      }
    }
    if (!referenceOnly && context.ast.kindName(declaration) === "KindInterfaceDeclaration" && selectedType !== undefined &&
      rustSourceTypeCarrierValue(carrier) !== undefined &&
      (context.currentSemantics.types.constructSignatures(selectedType).length !== 0 ||
        context.currentSemantics.types.propertyInfos(selectedType).some(property => property.optional &&
          context.currentSemantics.declarations.symbolDeclarations(property.symbol).some(member =>
            context.ast.kindName(member) === "KindMethodSignature")))) {
      return resolveStructuralObjectType(selectedType, context, options, resolving, declaration);
    }
    const presentCarrier = rustOptionElementCarrier(carrier) ?? carrier;
    const union = rustSourceUnionCarrierValue(presentCarrier);
    if (union !== undefined && carrier !== undefined) {
      const contract = context.sourceLifetimes.contractFor(declaration);
      const parameters = contract?.parameters ?? [];
      if (parameters.length !== genericArguments.values.length ||
        parameters.some((parameter, index) => parameter.kind !== genericArguments.values[index]?.kind)) continue;
      if (parameters.length === 0) return carrier;
      const template = options.sourceTypes.sourceUnionForCarrier(presentCarrier!);
      const substitutions = new Map<string, TargetTypeRef>();
      const lifetimes = new Map<string, RustLifetimeRef>();
      parameters.forEach((parameter, index) => {
        const argument = genericArguments.values[index]!;
        if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.identity, argument.type);
        if (parameter.kind === "lifetime" && argument.kind === "lifetime") lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
      });
      const instantiated = substituteRustTargetGenerics(carrier, substitutions, lifetimes);
      if (template === undefined || selectedType === undefined || referenceOnly) return instantiated;
      const selectedContext = bindRustSourceDeclarationArguments(declaration, selectedType, genericArguments.values, context);
      if (selectedContext === undefined) continue;
      const optional = rustOptionElementCarrier(instantiated);
      const result = retainRustSourceUnionInstantiation(selectedType, template, optional ?? instantiated, selectedContext, options, declaration);
      if (result !== undefined) return optional === undefined ? result : rustSourceOptionalTargetType(result);
      continue;
    }
    const sourceType = rustSourceTypeCarrierValue(carrier);
    if (sourceType !== undefined && context.ast.kindName(declaration) !== "KindTypeAliasDeclaration") {
      const parameters = rustProjectGenericParameters(declaration, context);
      const own = context.sourceLifetimes.contractFor(declaration)?.parameters ?? [];
      if (parameters === undefined || genericArguments.values.length !== own.length ||
        own.some((parameter, index) => genericArguments.values[index]?.kind !== parameter.kind)) {
        continue;
      }
      const semantics = context.semanticsFor(declaration);
      const instance = selectedType ?? semantics.declarations.declaredType(declaration);
      const bindings = parameters.length === own.length || instance === undefined
        ? undefined : context.currentSemantics.types.typeArgumentBindings(instance);
      const arguments_ = parameters.map(parameter => {
        const localIndex = own.findIndex(candidate => candidate.declaration === parameter.declaration);
        if (localIndex >= 0) return genericArguments.values[localIndex];
        const binding = bindings?.find(candidate => candidate.declaration === parameter.declaration && candidate.scope === "outer");
        if (binding === undefined || parameter.kind !== "type") return undefined;
        const type = context.sourceTypeParameterSubstitutions?.get(parameter.declaration)?.carrier ??
          resolveRustTargetType(binding.argumentType, context, options, resolving);
        return type === undefined ? undefined : { kind: "type" as const, type };
      });
      if (arguments_.some(argument => argument === undefined)) continue;
      return rustSourceTypeCarrier(
        sourceType.fileName,
        sourceType.typeName,
        sourceType.shape,
        Object.freeze(arguments_ as readonly RustTargetGenericArgument[]),
      );
    }
    if (carrier !== undefined) {
      const parameters = context.sourceLifetimes.contractFor(declaration)?.parameters ?? [];
      if (parameters.length !== genericArguments.values.length ||
        parameters.some((parameter, index) => parameter.kind !== genericArguments.values[index]?.kind)) continue;
      const substitutions = new Map<string, TargetTypeRef>();
      const lifetimes = new Map<string, RustLifetimeRef>();
      parameters.forEach((parameter, index) => {
        const argument = genericArguments.values[index]!;
        if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.identity, argument.type);
        if (parameter.kind === "lifetime" && argument.kind === "lifetime") lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
      });
      const instantiated = substituteRustTargetGenerics(carrier, substitutions, lifetimes);
      const sourceSubstitutions = new Map(context.sourceTypeParameterSubstitutions);
      const application = selectedType === undefined ? undefined : context.currentSemantics.types.aliasApplication(selectedType);
      for (const [index, parameter] of parameters.entries()) {
        const argument = genericArguments.values[index];
        const binding = application?.bindings.find(binding => binding.declaration === parameter.declaration);
        if (argument?.kind === "type" && binding !== undefined) {
          sourceSubstitutions.set(parameter.declaration, { sourceType: binding.argument, carrier: argument.type });
        }
      }
      if (rustStructuralObjectCarrierValue(carrier) === undefined) return instantiated;
      const selectedContext = { ...context, sourceTypeParameterSubstitutions: sourceSubstitutions };
      if (selectedType === undefined || !retainRustStructuralInstantiation(
        selectedType, carrier, instantiated, selectedContext, options, resolving)) continue;
      const normalized = mapRustTargetTypes(instantiated, rustTypeFamilyNormalizer(options.sourceTypes.typeFamilies));
      if (!retainRustStructuralInstantiation(selectedType, carrier, normalized, selectedContext, options, resolving)) continue;
      return normalized;
    }
  }
  return undefined;
}

function resolveProjectCallableInterface(
  declaration: Node,
  selectedType: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): TargetTypeRef | undefined {
  const symbol = context.currentSemantics.declarations.typeSymbol(selectedType);
  const declarations = symbol === undefined ? [declaration]
    : denseDefined(context.currentSemantics.declarations.symbolDeclarations(symbol));
  if (declarations === undefined || declarations.length === 0 ||
    declarations.some(candidate => !context.ast.is.IsInterfaceDeclaration(candidate))) return undefined;
  const inherited: TargetTypeRef[] = [];
  for (const candidate of declarations) {
    const heritage = context.source.navigation.declaredHeritage(candidate);
    if (heritage.kind !== "resolved") return undefined;
    for (const edge of heritage.edges) {
      const contract = context.sourceLifetimes.contractFor(edge.target.declaration);
      if (edge.kind !== "extends" || contract === undefined) return undefined;
      const arguments_ = resolveRustSourceDeclarationArguments(edge.typeArguments, contract, context,
        options, resolving, edge.selectedType);
      const semantics = context.semanticsFor(edge.target.declaration);
      const base = arguments_ === undefined ? undefined : resolveProjectSourceCarrier(
        semantics.declarations.typeSymbol(edge.selectedType), arguments_,
        { ...context, currentSemantics: semantics }, options, edge.target.declaration, edge.selectedType, resolving,
      );
      if (base === undefined) return undefined;
      inherited.push(base);
    }
  }
  const ownSignature = declarations.some(candidate => context.ast.members(candidate).some(member =>
    member !== undefined && context.ast.is.IsCallSignatureDeclaration(member)));
  const selected = ownSignature || inherited.length === 0
    ? resolveCallableType(selectedType, context, options, resolving) : inherited[0];
  return selected === undefined || inherited.some(base =>
    !rustTargetTypeRefEquals(base, selected) && !rustGenericCallableSignaturesMatch(base, selected))
    ? undefined : selected;
}

export function denseDefined<T>(values: readonly (T | undefined)[]): readonly T[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly T[]
    : undefined;
}

import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
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
  const declarations = selectedDeclaration === undefined
    ? symbolDeclarations
    : [
        selectedDeclaration,
        ...symbolDeclarations.filter((declaration) => declaration !== selectedDeclaration),
      ];
  for (const declaration of declarations) {
    const carrier = options.sourceTypes.carrierForDeclaration(declaration, context.ast);
    if (selectedType !== undefined && (context.ast.is.IsClassDeclaration(declaration) || context.ast.is.IsClassExpression(declaration))) {
      const signatures = context.currentSemantics.types.constructSignatures(selectedType);
      if (signatures.length > 0) {
        const instances = signatures.map(signature => {
          const result = context.currentSemantics.types.returnType(signature);
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
          const open = parameter.kind === "type" ? argument.kind === "type" && argument.type.kind === "type-parameter" && argument.type.name === parameter.targetName
            : argument.kind === "lifetime" && rustLifetimeKey(argument.lifetime) === rustLifetimeKey(parameter.lifetime);
          return own.has(parameter.declaration) && open ? [index] : [];
        });
        return rustClassConstructorTargetType(instance, bound);
      }
    }
    if (context.ast.kindName(declaration) === "KindInterfaceDeclaration" && selectedType !== undefined &&
      rustSourceTypeCarrierValue(carrier) !== undefined &&
      context.currentSemantics.types.constructSignatures(selectedType).length !== 0) {
      return resolveStructuralObjectType(selectedType, context, options, resolving, declaration);
    }
    const union = rustSourceUnionCarrierValue(carrier);
    if (union !== undefined && carrier !== undefined) {
      const contract = context.sourceLifetimes.contractFor(declaration);
      const parameters = contract?.parameters ?? [];
      if (parameters.length !== genericArguments.values.length ||
        parameters.some((parameter, index) => parameter.kind !== genericArguments.values[index]?.kind)) continue;
      if (parameters.length === 0) return carrier;
      const template = options.sourceTypes.sourceUnionForCarrier(carrier);
      const substitutions = new Map<string, TargetTypeRef>();
      const lifetimes = new Map<string, RustLifetimeRef>();
      parameters.forEach((parameter, index) => {
        const argument = genericArguments.values[index]!;
        if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.targetName, argument.type);
        if (parameter.kind === "lifetime" && argument.kind === "lifetime") lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
      });
      const instantiated = substituteRustTargetGenerics(carrier, substitutions, lifetimes);
      if (template === undefined || selectedType === undefined || referenceOnly) return instantiated;
      const result = retainRustSourceUnionInstantiation(selectedType, template, instantiated, context, options, resolving);
      if (result !== undefined) return result;
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
        if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.targetName, argument.type);
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

export function denseDefined<T>(values: readonly (T | undefined)[]): readonly T[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly T[]
    : undefined;
}

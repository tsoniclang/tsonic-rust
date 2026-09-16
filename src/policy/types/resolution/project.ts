import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import type { Node, Symbol, Type } from "@tsonic/tsts";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { retainRustSourceUnionInstantiation } from "./source-unions.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetGenericArgument } from "../../../target-model/types/model.js";
import { rustProjectGenericParameters } from "../project-generic-contract.js";
import { resolveRustTargetType } from "./target.js";
import { retainRustStructuralInstantiation } from "./structural-instantiations.js";

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
        const type = context.sourceTypeParameterSubstitutions?.get(parameter.declaration) ??
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
      if (rustStructuralObjectCarrierValue(carrier) !== undefined &&
        (selectedType === undefined || !retainRustStructuralInstantiation(
          selectedType, carrier, instantiated, context, options))) continue;
      return instantiated;
    }
  }
  return undefined;
}

export function denseDefined<T>(values: readonly (T | undefined)[]): readonly T[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly T[]
    : undefined;
}

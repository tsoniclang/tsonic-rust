import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
} from "../../../target-model/types/index.js";
import type { Node, Symbol, Type } from "@tsonic/tsts";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustLifetimeKey, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { retainRustSourceUnionInstantiation } from "./source-unions.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetGenericArgument } from "../../../target-model/types/model.js";

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
      if (selectedType === undefined || template === undefined) continue;
      const substitutions = new Map<string, TargetTypeRef>();
      const lifetimes = new Map<string, RustLifetimeRef>();
      parameters.forEach((parameter, index) => {
        const argument = genericArguments.values[index]!;
        if (parameter.kind === "type" && argument.kind === "type") substitutions.set(parameter.targetName, argument.type);
        if (parameter.kind === "lifetime" && argument.kind === "lifetime") lifetimes.set(rustLifetimeKey(parameter.lifetime), argument.lifetime);
      });
      const instantiated = substituteRustTargetGenerics(carrier, substitutions, lifetimes);
      const result = retainRustSourceUnionInstantiation(selectedType, template, instantiated, context, options, resolving);
      if (result !== undefined) return result;
      continue;
    }
    const sourceType = rustSourceTypeCarrierValue(carrier);
    if (sourceType !== undefined) {
      const contract = context.sourceLifetimes.contractFor(declaration);
      if (contract === undefined
        ? genericArguments.values.length !== 0
        : genericArguments.values.length !== contract.parameters.length ||
          contract.parameters.some((parameter, index) =>
            genericArguments.values[index]?.kind !== parameter.kind)) {
        continue;
      }
      return rustSourceTypeCarrier(
        sourceType.fileName,
        sourceType.typeName,
        sourceType.shape,
        genericArguments.values,
      );
    }
    if (carrier !== undefined && genericArguments.values.length === 0) {
      return carrier;
    }
  }
  return undefined;
}

export function denseDefined<T>(values: readonly (T | undefined)[]): readonly T[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly T[]
    : undefined;
}

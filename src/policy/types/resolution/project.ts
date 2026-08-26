import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
} from "../../../target-model/types/index.js";
import type { Node, Symbol } from "@tsonic/tsts";
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

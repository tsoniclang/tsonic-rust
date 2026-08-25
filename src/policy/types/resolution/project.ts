import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import {
  rustGenericSubstitutionsForArguments,
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  substituteRustTargetGenerics,
} from "../../../target-model/types/index.js";
import type { Node, Symbol } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustGenericArgument } from "../../../target-model/semantics/index.js";

export function resolveProjectSourceCarrier(
  symbol: Symbol | undefined,
  genericArguments: readonly RustGenericArgument[],
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
      return rustSourceTypeCarrier(
        sourceType.fileName,
        sourceType.typeName,
        sourceType.shape,
        genericArguments,
      );
    }
    if (carrier !== undefined) {
      const contract = context.sourceGenerics.contractFor(declaration);
      if (contract === undefined) {
        if (genericArguments.length === 0) return carrier;
        continue;
      }
      const substitutions = rustGenericSubstitutionsForArguments(
        contract.generics,
        genericArguments,
      );
      if (substitutions !== undefined) {
        return substituteRustTargetGenerics(carrier, substitutions);
      }
    }
  }
  return undefined;
}

export function denseDefined<T>(values: readonly (T | undefined)[]): readonly T[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly T[]
    : undefined;
}

import { isDenseDataArray } from "../../model/closed-data.js";
import { rustSourceTypeCarrier, rustSourceTypeCarrierValue } from "../target-types.js";
import type { Node, Symbol } from "@tsonic/tsts";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function resolveProjectSourceCarrier(
  symbol: Symbol | undefined,
  typeArguments: readonly TargetTypeRef[],
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
        typeArguments,
      );
    }
    if (carrier !== undefined && typeArguments.length === 0) {
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

import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustSourceTypeRegistry, RustStructuralFieldRegistration } from "./source-type-registry.js";

export function selectRustStructuralFieldProjection(
  registry: RustSourceTypeRegistry,
  symbol: Symbol,
  declarations: readonly Node[],
  carrier: TargetTypeRef,
): RustStructuralFieldRegistration | undefined {
  const candidates = [registry.structuralFieldProjectionForSymbol(symbol, carrier),
    ...declarations.map(declaration => registry.structuralFieldProjectionForDeclaration(declaration, carrier))]
    .filter(candidate => candidate !== undefined);
  const first = candidates[0];
  return first !== undefined && candidates.every(candidate =>
    candidate.shape.storage === first.shape.storage &&
    candidate.field.storageIndex === first.field.storageIndex &&
    candidate.field.presence === first.field.presence &&
    candidate.field.readonly === first.field.readonly &&
    candidate.field.accessor?.getter === first.field.accessor?.getter &&
    candidate.field.accessor?.setter === first.field.accessor?.setter &&
    candidate.field.method === first.field.method &&
    rustTargetTypeRefEquals(candidate.field.resultCarrier, first.field.resultCarrier)) ? first : undefined;
}

import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { isRustNumericCarrier, rustSourcePrimitiveTargetType } from "../../../../target-model/types/index.js";
import { rustNumericPromotionKind } from "../../../../target-model/conversions/numeric-promotion.js";
import { rustRestSequenceElements } from "../../../../target-model/operations/rest-assembly.js";

export function selectRustNumericRestCarrier(
  arguments_: readonly (TargetTypeRef | undefined)[],
  spreadIndexes: readonly number[],
): TargetTypeRef | undefined {
  const elements: TargetTypeRef[] = [];
  for (const [index, carrier] of arguments_.entries()) {
    if (carrier === undefined) return undefined;
    const selected = spreadIndexes.includes(index) ? rustRestSequenceElements(carrier)?.elements : [carrier];
    if (selected === undefined) return undefined;
    elements.push(...selected);
  }
  if (elements.some(element => !isRustNumericCarrier(element))) return undefined;
  if (elements.length === 0) return rustSourcePrimitiveTargetType("float64");
  const inputs = elements as Extract<TargetTypeRef, { kind: "source-primitive" }>[];
  const candidates = [...inputs, ...(["int32", "uint32", "int64", "uint64", "int128", "uint128", "float64"] as const)
    .map(rustSourcePrimitiveTargetType)];
  return candidates.find(candidate => candidate.kind === "source-primitive" && inputs.every(input => {
    if (input.name === candidate.name) return true;
    if (candidate.name === "float64" && !["int8", "uint8", "int16", "uint16", "int32", "uint32", "float32"].includes(input.name)) return false;
    if (candidate.name === "float32" && !["int8", "uint8", "int16", "uint16"].includes(input.name)) return false;
    return rustNumericPromotionKind(input.name, candidate.name) === candidate.name;
  }));
}

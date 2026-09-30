import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustRestSequenceElements } from "../../target-model/operations/rest-assembly.js";

export function selectRustArrayLiteralSpread(source: TargetTypeRef, element: TargetTypeRef):
    "vec" | "js-array" | "fixed-array" | "tuple" | undefined {
  const sequence = rustRestSequenceElements(source);
  return sequence !== undefined && sequence.elements.every(candidate => rustTargetTypeRefEquals(candidate, element))
    ? sequence.collection : undefined;
}

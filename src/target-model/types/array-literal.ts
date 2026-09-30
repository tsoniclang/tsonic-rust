import type { TargetTypeRef } from "./model.js";
import { rustTargetTypeRefEquals } from "./equality.js";
import { rustRestSequenceElements } from "../operations/rest-assembly.js";

export function rustArrayLiteralSpreadContract(source: TargetTypeRef, element: TargetTypeRef):
    "vec" | "js-array" | "fixed-array" | "tuple" | undefined {
  const sequence = rustRestSequenceElements(source);
  return sequence !== undefined && sequence.elements.every(candidate => rustTargetTypeRefEquals(candidate, element))
    ? sequence.collection : undefined;
}

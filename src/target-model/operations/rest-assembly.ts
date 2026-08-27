import { rustFixedArrayCarrierValue } from "../types/carriers/native.js";
import { rustTargetConstSafeInteger } from "../types/generic-arguments.js";
import type { TargetTypeRef } from "../types/model.js";

export const rustVecRestAssembly = Object.freeze({
  appendElementMethod: "push",
  appendSequenceMethod: "extend",
});

export function rustSpreadElementCarrier(
  sourceCarrier: TargetTypeRef,
  index: number,
): TargetTypeRef | undefined {
  if (!Number.isSafeInteger(index) || index < 0) {
    return undefined;
  }
  if (sourceCarrier.kind === "tuple") {
    return sourceCarrier.elements[index];
  }
  const fixedArray = rustFixedArrayCarrierValue(sourceCarrier);
  const fixedLength = fixedArray === undefined
    ? undefined
    : rustTargetConstSafeInteger(fixedArray.length);
  return fixedArray !== undefined && fixedLength !== undefined && index < fixedLength
    ? fixedArray.element
    : undefined;
}

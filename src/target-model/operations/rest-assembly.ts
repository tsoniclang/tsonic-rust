import { rustFixedArrayCarrierValue } from "../types/carriers/native.js";
import { rustTargetConstInteger } from "../types/generic-arguments.js";
import { isRustJsArrayCarrier, rustJsArrayLikeElementTargetType } from "../types/carriers/js.js";
import type { TargetTypeRef } from "../types/model.js";

export const rustVecRestAssembly = Object.freeze({
  appendElementMethod: "push",
  appendSequenceMethod: "extend",
});

export function rustRestSequenceElements(source: TargetTypeRef): {
  readonly collection: "vec" | "js-array" | "fixed-array" | "tuple";
  readonly elements: readonly TargetTypeRef[];
} | undefined {
  if (source.kind === "tuple") return { collection: "tuple", elements: source.elements };
  if (source.kind === "array") return { collection: "vec", elements: [source.element] };
  const fixed = rustFixedArrayCarrierValue(source);
  if (fixed !== undefined) return { collection: "fixed-array", elements: [fixed.element] };
  const element = isRustJsArrayCarrier(source) ? rustJsArrayLikeElementTargetType(source) : undefined;
  return element === undefined ? undefined : { collection: "js-array", elements: [element] };
}

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
    : rustTargetConstInteger(fixedArray.length);
  return fixedArray !== undefined && fixedLength !== undefined && BigInt(index) < fixedLength
    ? fixedArray.element
    : undefined;
}

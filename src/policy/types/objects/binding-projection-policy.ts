import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSelectedBindingProjection } from "../../../target-model/records/objects/value-projections.js";
import { isRustJsArrayCarrier, rustJsArrayLikeElementTargetType, isRustVecCarrier, rustFixedArrayCarrierValue, rustFixedArrayTargetType, rustTargetConstInteger, rustOptionTargetType } from "../../../target-model/types/index.js";
import { rustTupleTargetType } from "../collections/tuple-carrier.js";

export function selectRustBindingPatternProjection(
  sourceCarrier: TargetTypeRef,
  index: number,
  rest: boolean,
  hasDefault: boolean,
): RustSelectedBindingProjection | undefined {
  if (rest) {
    if (hasDefault) {
      return undefined;
    }
    const projection: RustSelectedBindingProjection["projection"] | undefined = sourceCarrier.kind === "tuple"
      ? { kind: "tuple-rest", start: index }
      : rustFixedArrayCarrierValue(sourceCarrier) !== undefined
        ? { kind: "fixed-array-rest", start: index }
        : isRustVecCarrier(sourceCarrier)
          ? { kind: "vec-rest", start: index }
          : isRustJsArrayCarrier(sourceCarrier)
            ? { kind: "js-array-rest", start: index }
            : undefined;
    const bindingCarrier = bindingCarrierForArrayRest(sourceCarrier, index);
    return projection === undefined || bindingCarrier === undefined
      ? undefined
      : { projectedCarrier: bindingCarrier, projection };
  }

  let projectedCarrier: TargetTypeRef | undefined;
  let projection: RustSelectedBindingProjection["projection"] | undefined;
  if (sourceCarrier.kind === "tuple") {
    projectedCarrier = sourceCarrier.elements[index];
    projection = { kind: "tuple-element", index };
  } else {
    const fixed = rustFixedArrayCarrierValue(sourceCarrier);
    const fixedLength = fixed === undefined
      ? undefined
      : rustTargetConstInteger(fixed.length);
    if (fixed !== undefined && fixedLength !== undefined && BigInt(index) < fixedLength) {
      projectedCarrier = fixed.element;
      projection = { kind: "fixed-array-element", index };
    } else if (isRustVecCarrier(sourceCarrier)) {
      projectedCarrier = hasDefault
        ? rustOptionTargetType(sourceCarrier.element)
        : sourceCarrier.element;
      projection = { kind: "vec-element", index, checked: hasDefault };
    } else if (isRustJsArrayCarrier(sourceCarrier)) {
      const elementCarrier = rustJsArrayLikeElementTargetType(sourceCarrier);
      projectedCarrier = elementCarrier === undefined
        ? undefined
        : rustOptionTargetType(elementCarrier);
      projection = { kind: "js-array-element", index };
    }
  }
  return projectedCarrier === undefined || projection === undefined ? undefined
    : { projectedCarrier, projection, ...(projection.kind === "js-array-element"
      ? { checkedArrayElement: rustJsArrayLikeElementTargetType(sourceCarrier)! } : {}) };
}

function bindingCarrierForArrayRest(
  sourceCarrier: TargetTypeRef,
  start: number,
): TargetTypeRef | undefined {
  if (sourceCarrier.kind === "tuple") {
    return rustTupleTargetType(sourceCarrier.elements.slice(start));
  }
  const fixed = rustFixedArrayCarrierValue(sourceCarrier);
  const fixedLength = fixed === undefined
    ? undefined
    : rustTargetConstInteger(fixed.length);
  if (fixed !== undefined && fixedLength !== undefined && BigInt(start) <= fixedLength) {
    return rustFixedArrayTargetType(fixed.element, {
      kind: "integer",
      value: (fixedLength - BigInt(start)).toString(),
    });
  }
  return isRustVecCarrier(sourceCarrier) || isRustJsArrayCarrier(sourceCarrier)
    ? sourceCarrier
    : undefined;
}

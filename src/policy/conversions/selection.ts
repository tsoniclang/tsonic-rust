import type { RustValueConversion } from "../../target-model/operations/model.js";
import { rustNumericPromotionKind } from "../../target-model/conversions/numeric-promotion.js";
import {
  isRustNeverCarrier,
  rustJsValueTargetType,
  rustOptionElementCarrier,
  rustSourcePrimitiveTargetType,
  rustSourceUnionCarrierValue,
  rustStringTargetType,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  rustBoolToJsValueConversion,
  rustFloat64ToInt32ValueConversion,
  rustFloat64ToJsValueConversion,
  rustInt32ToFloat64ValueConversion,
  rustInt32ToJsValueConversion,
  rustInt32ToUint8ValueConversion,
  rustJsValueCloneConversion,
  rustStringToJsValueConversion,
  rustUint32ToInt32ValueConversion,
  rustUint64ToFloat64ValueConversion,
  rustUint8ToInt32ValueConversion,
} from "../../target-model/conversions/model.js";

const boolCarrier = rustSourcePrimitiveTargetType("bool");
const int32Carrier = rustSourcePrimitiveTargetType("int32");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const stringCarrier = rustStringTargetType();
const jsValueCarrier = rustJsValueTargetType();

export function selectRustSourceValueConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
): RustValueConversion | undefined {
  const sourceOptionElement = rustOptionElementCarrier(source);
  const targetOptionElement = rustOptionElementCarrier(target);
  if (sourceOptionElement !== undefined && targetOptionElement !== undefined) {
    const elementConversion = selectRustSourceValueConversion(
      sourceOptionElement,
      targetOptionElement,
    );
    if (elementConversion === undefined || elementConversion.kind === "option-map" ||
      elementConversion.kind === "option-some") {
      return undefined;
    }
    return { kind: "option-map", elementConversion };
  }
  if (isRustNeverCarrier(source)) {
    return Object.freeze({ kind: "bottom-coercion", source, target });
  }
  const targetUnion = rustSourceUnionCarrierValue(target);
  const matchingUnionVariants = targetUnion?.variants.filter((variant) =>
    rustTargetTypeRefEquals(variant.carrier, source)) ?? [];
  if (matchingUnionVariants.length === 1) {
    return Object.freeze({
      kind: "source-union-variant",
      source,
      target,
      variantName: matchingUnionVariants[0]!.name,
    });
  }
  if (source.kind === "raw-pointer" && target.kind === "raw-pointer" &&
    source.mutable && !target.mutable &&
    rustTargetTypeRefEquals(source.target, target.target)) {
    return Object.freeze({
      kind: "raw-pointer-mut-to-const",
      pointee: source.target,
    });
  }
  if (rustTargetTypeRefEquals(target, jsValueCarrier)) {
    if (rustTargetTypeRefEquals(source, jsValueCarrier)) {
      return rustJsValueCloneConversion;
    }
    if (rustTargetTypeRefEquals(source, boolCarrier)) {
      return rustBoolToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, float64Carrier)) {
      return rustFloat64ToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, int32Carrier)) {
      return rustInt32ToJsValueConversion;
    }
    if (rustTargetTypeRefEquals(source, stringCarrier)) {
      return rustStringToJsValueConversion;
    }
    return undefined;
  }
  if (source.kind !== "source-primitive" || target.kind !== "source-primitive") {
    return undefined;
  }
  if (source.name === "float64" && target.name === "int32") {
    return rustFloat64ToInt32ValueConversion;
  }
  if (source.name === "int32" && target.name === "uint8") {
    return rustInt32ToUint8ValueConversion;
  }
  if (source.name === "uint8" && target.name === "int32") {
    return rustUint8ToInt32ValueConversion;
  }
  if (source.name === "int32" && target.name === "float64") {
    return rustInt32ToFloat64ValueConversion;
  }
  if (source.name === "uint32" && target.name === "int32") {
    return rustUint32ToInt32ValueConversion;
  }
  if (source.name === "uint64" && target.name === "float64") {
    return rustUint64ToFloat64ValueConversion;
  }
  return source.name !== target.name &&
      rustNumericPromotionKind(source.name, target.name) === target.name
    ? { kind: "numeric-promotion", source: source.name, target: target.name }
    : undefined;
}

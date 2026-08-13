import type { TargetTypeRef } from "../../policy/types.js";
import {
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
} from "../../policy/equality.js";
import type {
  RustValueConversion,
  RustValueConversionId,
} from "./keys.js";
import {
  isRustNeverCarrier,
  isRustNumericCarrier,
  rustNeverTargetType,
  rustIsizeTargetType,
  rustJsValueTargetType,
  rustPrimitiveTypeName,
  rustSourceUnionCarrierValue,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUsizeTargetType,
} from "../rust-target-types.js";
import type { RustPrimitiveTypeName } from "../../common/rust-syntax.js";
import { rustNumericPromotionKind } from "../rust-target-semantics/numeric-promotion.js";

const boolCarrier = rustSourcePrimitiveTargetType("bool");
const int32Carrier = rustSourcePrimitiveTargetType("int32");
const uint8Carrier = rustSourcePrimitiveTargetType("uint8");
const uint32Carrier = rustSourcePrimitiveTargetType("uint32");
const uint64Carrier = rustSourcePrimitiveTargetType("uint64");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const usizeCarrier = rustUsizeTargetType();
const isizeCarrier = rustIsizeTargetType();
const stringCarrier = rustStringTargetType();
const jsValueCarrier = rustJsValueTargetType();

interface RustValueConversionContractBase {
  readonly category: "exact" | "checked-range" | "js-number" | "numeric-promotion";
  readonly sourceMode: "value" | "ref";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly fallible: boolean;
}

export type RustValueConversionContract = RustValueConversionContractBase & (
  | {
      readonly lowering: "call";
      readonly path: string;
    }
  | {
      readonly lowering: "numeric-cast";
      readonly targetType: RustPrimitiveTypeName;
    }
  | {
      readonly lowering: "identity";
    }
  | {
      readonly lowering: "source-union-variant";
      readonly variantName: string;
    }
);

function conversion(id: RustValueConversionId): RustValueConversion {
  return Object.freeze({ kind: "semantic-conversion", id });
}

export const rustInt32ToUsizeValueConversion = conversion("checked-i32-to-usize");
export const rustInt32ToUint8ValueConversion = conversion("checked-i32-to-u8");
export const rustUsizeToInt32ValueConversion = conversion("checked-usize-to-i32");
export const rustIsizeToInt32ValueConversion = conversion("checked-isize-to-i32");
export const rustUint32ToInt32ValueConversion = conversion("checked-u32-to-i32");
export const rustUint8ToInt32ValueConversion = conversion("exact-u8-to-i32");
export const rustInt32ToFloat64ValueConversion = conversion("exact-i32-to-f64");
export const rustFloat64ToInt32ValueConversion = conversion("checked-f64-to-i32-trunc");
export const rustIsizeToFloat64ValueConversion = conversion("js-number-from-isize");
export const rustUsizeToFloat64ValueConversion = conversion("js-number-from-usize");
export const rustUint64ToFloat64ValueConversion = conversion("js-number-from-u64");
export const rustBoolToJsValueConversion = conversion("js-value-from-bool");
export const rustFloat64ToJsValueConversion = conversion("js-value-from-f64");
export const rustInt32ToJsValueConversion = conversion("js-value-from-i32");
export const rustStringToJsValueConversion = conversion("js-value-from-string");
export const rustJsValueCloneConversion = conversion("js-value-clone");

export function rustValueConversionContract(
  value: RustValueConversion,
): RustValueConversionContract | undefined {
  if (value.kind === "bottom-coercion") {
    return isRustNeverCarrier(value.source) && isRustTargetTypeRef(value.target)
      ? {
          category: "exact",
          lowering: "identity",
          sourceMode: "value",
          source: rustNeverTargetType(),
          target: value.target,
          fallible: false,
        }
      : undefined;
  }
  if (value.kind === "source-union-variant") {
    const union = rustSourceUnionCarrierValue(value.target);
    const matches = union?.variants.filter((variant) =>
      variant.name === value.variantName &&
      rustTargetTypeRefEquals(variant.carrier, value.source)) ?? [];
    return isRustTargetTypeRef(value.source) && isRustTargetTypeRef(value.target) &&
        matches.length === 1
      ? {
          category: "exact",
          lowering: "source-union-variant",
          sourceMode: "value",
          source: value.source,
          target: value.target,
          variantName: value.variantName,
          fallible: false,
        }
      : undefined;
  }
  if (value.kind === "raw-pointer-mut-to-const") {
    if (!isRustTargetTypeRef(value.pointee)) {
      return undefined;
    }
    return {
      category: "exact",
      lowering: "identity",
      sourceMode: "value",
      source: {
        kind: "pointer",
        pointee: value.pointee,
        mutability: "mut",
      },
      target: {
        kind: "pointer",
        pointee: value.pointee,
        mutability: "const",
      },
      fallible: false,
    };
  }
  if (value.kind === "numeric-promotion") {
    const source = rustSourcePrimitiveTargetType(value.source);
    const target = rustSourcePrimitiveTargetType(value.target);
    const targetType = rustPrimitiveTypeName(value.target);
    return isRustNumericCarrier(source) && isRustNumericCarrier(target) &&
        rustNumericPromotionKind(value.source, value.target) === value.target &&
        targetType !== undefined
      ? {
          category: "numeric-promotion",
          lowering: "numeric-cast",
          sourceMode: "value",
          source,
          target,
          targetType,
          fallible: false,
        }
      : undefined;
  }
  switch (value.id) {
    case "checked-i32-to-usize":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::i32_to_usize", "value", int32Carrier, usizeCarrier, true);
    case "checked-i32-to-u8":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::i32_to_u8", "value", int32Carrier, uint8Carrier, true);
    case "checked-usize-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::usize_to_i32", "value", usizeCarrier, int32Carrier, true);
    case "checked-isize-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::isize_to_i32", "value", isizeCarrier, int32Carrier, true);
    case "checked-u32-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::u32_to_i32", "value", uint32Carrier, int32Carrier, true);
    case "exact-u8-to-i32":
      return contract(value.id, "exact", "tsonic_rust_runtime::conversions::u8_to_i32", "value", uint8Carrier, int32Carrier, false);
    case "exact-i32-to-f64":
      return contract(value.id, "exact", "tsonic_rust_runtime::conversions::i32_to_f64", "value", int32Carrier, float64Carrier, false);
    case "checked-f64-to-i32-trunc":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::f64_to_i32", "value", float64Carrier, int32Carrier, true);
    case "js-number-from-isize":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::isize_to_f64", "value", isizeCarrier, float64Carrier, false);
    case "js-number-from-usize":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::usize_to_f64", "value", usizeCarrier, float64Carrier, false);
    case "js-number-from-u64":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::u64_to_f64", "value", uint64Carrier, float64Carrier, false);
    case "js-value-from-bool":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", boolCarrier, jsValueCarrier, false);
    case "js-value-from-f64":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", float64Carrier, jsValueCarrier, false);
    case "js-value-from-i32":
      return contract(value.id, "exact", "tsonic_rust_js::abi::JsValue::from", "value", int32Carrier, jsValueCarrier, false);
    case "js-value-from-string":
      return contract(value.id, "exact", "tsonic_rust_js::abi::js_value_from_string", "ref", stringCarrier, jsValueCarrier, false);
    case "js-value-clone":
      return contract(value.id, "exact", "tsonic_rust_js::abi::clone_js_value", "ref", jsValueCarrier, jsValueCarrier, false);
  }
}

function contract(
  _id: RustValueConversionId,
  category: RustValueConversionContract["category"],
  path: string,
  sourceMode: RustValueConversionContract["sourceMode"],
  source: TargetTypeRef,
  target: TargetTypeRef,
  fallible: boolean,
): RustValueConversionContract {
  return { category, lowering: "call", path, sourceMode, source, target, fallible };
}

export function rustValueConversionIsFallible(value: RustValueConversion | undefined): boolean {
  return value !== undefined && rustValueConversionContract(value)?.fallible === true;
}

export function rustValueConversionIdentity(value: RustValueConversion): string {
  return value.kind === "semantic-conversion"
    ? value.id
    : value.kind === "numeric-promotion"
      ? `numeric-promotion.${value.source}.${value.target}`
      : value.kind === "raw-pointer-mut-to-const"
        ? `raw-pointer-mut-to-const.${JSON.stringify(value.pointee)}`
        : value.kind === "source-union-variant"
          ? `source-union-variant.${value.variantName}.${JSON.stringify(value.source)}.${JSON.stringify(value.target)}`
          : `bottom-coercion.${JSON.stringify(value.target)}`;
}

export function selectRustSourceValueConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
): RustValueConversion | undefined {
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
  if (source.kind === "pointer" && target.kind === "pointer" &&
    source.mutability === "mut" && target.mutability === "const" &&
    rustTargetTypeRefEquals(source.pointee, target.pointee)) {
    return Object.freeze({
      kind: "raw-pointer-mut-to-const",
      pointee: source.pointee,
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

import type { TargetTypeRef } from "../../policy/types.js";
import type {
  RustValueConversion,
  RustValueConversionId,
} from "./keys.js";
import {
  rustIsizeTargetType,
  rustSourcePrimitiveTargetType,
  rustUsizeTargetType,
} from "../rust-target-types.js";

const int32Carrier = rustSourcePrimitiveTargetType("int32");
const uint8Carrier = rustSourcePrimitiveTargetType("uint8");
const uint32Carrier = rustSourcePrimitiveTargetType("uint32");
const uint64Carrier = rustSourcePrimitiveTargetType("uint64");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const usizeCarrier = rustUsizeTargetType();
const isizeCarrier = rustIsizeTargetType();

export interface RustValueConversionContract {
  readonly id: RustValueConversionId;
  readonly category: "exact" | "checked-range" | "js-number";
  readonly path: string;
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly fallible: boolean;
}

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

export function rustValueConversionContract(
  value: RustValueConversion,
): RustValueConversionContract | undefined {
  switch (value.id) {
    case "checked-i32-to-usize":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::i32_to_usize", int32Carrier, usizeCarrier, true);
    case "checked-i32-to-u8":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::i32_to_u8", int32Carrier, uint8Carrier, true);
    case "checked-usize-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::usize_to_i32", usizeCarrier, int32Carrier, true);
    case "checked-isize-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::isize_to_i32", isizeCarrier, int32Carrier, true);
    case "checked-u32-to-i32":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::u32_to_i32", uint32Carrier, int32Carrier, true);
    case "exact-u8-to-i32":
      return contract(value.id, "exact", "tsonic_rust_runtime::conversions::u8_to_i32", uint8Carrier, int32Carrier, false);
    case "exact-i32-to-f64":
      return contract(value.id, "exact", "tsonic_rust_runtime::conversions::i32_to_f64", int32Carrier, float64Carrier, false);
    case "checked-f64-to-i32-trunc":
      return contract(value.id, "checked-range", "tsonic_rust_runtime::conversions::f64_to_i32", float64Carrier, int32Carrier, true);
    case "js-number-from-isize":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::isize_to_f64", isizeCarrier, float64Carrier, false);
    case "js-number-from-usize":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::usize_to_f64", usizeCarrier, float64Carrier, false);
    case "js-number-from-u64":
      return contract(value.id, "js-number", "tsonic_rust_runtime::conversions::u64_to_f64", uint64Carrier, float64Carrier, false);
  }
}

function contract(
  id: RustValueConversionId,
  category: RustValueConversionContract["category"],
  path: string,
  source: TargetTypeRef,
  target: TargetTypeRef,
  fallible: boolean,
): RustValueConversionContract {
  return { id, category, path, source, target, fallible };
}

export function rustValueConversionIsFallible(value: RustValueConversion | undefined): boolean {
  return value !== undefined && rustValueConversionContract(value)?.fallible === true;
}

export function selectRustSourceValueConversion(
  source: TargetTypeRef,
  target: TargetTypeRef,
): RustValueConversion | undefined {
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
  return undefined;
}

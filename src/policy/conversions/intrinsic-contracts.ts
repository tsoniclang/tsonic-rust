import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustValueConversionId } from "../../target-model/operations/model.js";
import { rustJsNumericTargetType, rustJsStringNumberTargetType, rustBigIntTargetType, rustJsStringTargetType, rustJsSymbolTargetType, rustSourceOptionalTargetType, rustJsValueTargetType, rustJsErrorTargetType, rustSourcePrimitiveTargetType, rustBorrowedStrTargetType, rustStringTargetType, rustAbsenceTargetType, rustTsValueTargetType } from "../../target-model/types/index.js";

import { rustNumberBoxingSourceKind } from "../../target-model/conversions/number-boxing.js";

const boolCarrier = rustSourcePrimitiveTargetType("bool");
const int32Carrier = rustSourcePrimitiveTargetType("int32");
const uint8Carrier = rustSourcePrimitiveTargetType("uint8");
const uint32Carrier = rustSourcePrimitiveTargetType("uint32");
const uint64Carrier = rustSourcePrimitiveTargetType("uint64");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const usizeCarrier = rustSourcePrimitiveTargetType("native-uint");
const isizeCarrier = rustSourcePrimitiveTargetType("native-int");
const stringCarrier = rustStringTargetType();
const exactStringCarrier = rustJsStringTargetType();
const symbolCarrier = rustJsSymbolTargetType();
const jsValueCarrier = rustJsValueTargetType();
const tsValueCarrier = rustTsValueTargetType();
const absenceCarrier = rustAbsenceTargetType();

import type { RustValueConversionContract } from "../../target-model/conversions/contracts.js";
export function selectRustIntrinsicConversionContract(id: RustValueConversionId): RustValueConversionContract | undefined {
  const numberBoxingSource = rustNumberBoxingSourceKind(id);
  if (numberBoxingSource !== undefined) {
    return contract(id, "exact", "js_abi::JsValue::from", "value",
      rustSourcePrimitiveTargetType(numberBoxingSource), jsValueCarrier, false);
  }
  switch (id) {
    case "native-f64-to-f32":
      return { category: "native-numeric-cast", sourceMode: "value", source: float64Carrier,
        target: rustSourcePrimitiveTargetType("float32"), lowering: "numeric-cast", targetType: "f32", fallible: false };
    case "js-numeric-from-number":
      return contract(id, "exact", "js_abi::JsNumeric::from_number", "value", float64Carrier, rustJsNumericTargetType(), false);
    case "js-string-number-from-string":
      return contract(id, "exact", "js_abi::JsStringNumber::from_string", "value", stringCarrier, rustJsStringNumberTargetType(), false);
    case "js-string-number-from-number":
      return contract(id, "exact", "js_abi::JsStringNumber::from_number", "value", float64Carrier, rustJsStringNumberTargetType(), false);
    case "js-string-number-from-int32":
      return contract(id, "exact", "js_abi::JsStringNumber::from_int32", "value", int32Carrier, rustJsStringNumberTargetType(), false);
    case "js-numeric-from-int32":
      return contract(id, "exact", "js_abi::JsNumeric::from_int32", "value", int32Carrier, rustJsNumericTargetType(), false);
    case "js-numeric-from-bigint":
      return contract(id, "exact", "js_abi::JsNumeric::from_bigint", "ref", rustBigIntTargetType(), rustJsNumericTargetType(), false);
    case "checked-i32-to-usize":
      return contract(id, "checked-range", "rt::conversions::i32_to_usize", "value", int32Carrier, usizeCarrier, true);
    case "checked-i32-to-u8":
      return contract(id, "checked-range", "rt::conversions::i32_to_u8", "value", int32Carrier, uint8Carrier, true);
    case "checked-f64-to-u8-trunc":
      return contract(id, "checked-range", "rt::conversions::f64_to_u8", "value", float64Carrier, uint8Carrier, true);
    case "checked-usize-to-i32":
      return contract(id, "checked-range", "rt::conversions::usize_to_i32", "value", usizeCarrier, int32Carrier, true);
    case "checked-isize-to-i32":
      return contract(id, "checked-range", "rt::conversions::isize_to_i32", "value", isizeCarrier, int32Carrier, true);
    case "checked-u32-to-i32":
      return contract(id, "checked-range", "rt::conversions::u32_to_i32", "value", uint32Carrier, int32Carrier, true);
    case "exact-u8-to-i32":
      return contract(id, "exact", "rt::conversions::u8_to_i32", "value", uint8Carrier, int32Carrier, false);
    case "exact-i32-to-f64":
      return contract(id, "exact", "rt::conversions::i32_to_f64", "value", int32Carrier, float64Carrier, false);
    case "checked-f64-to-i32-trunc":
      return contract(id, "checked-range", "rt::conversions::f64_to_i32", "value", float64Carrier, int32Carrier, true);
    case "js-number-from-isize":
      return contract(id, "js-number", "rt::conversions::isize_to_f64", "value", isizeCarrier, float64Carrier, false);
    case "js-number-from-usize":
      return contract(id, "js-number", "rt::conversions::usize_to_f64", "value", usizeCarrier, float64Carrier, false);
    case "js-number-from-u64":
      return contract(id, "js-number", "rt::conversions::u64_to_f64", "value", uint64Carrier, float64Carrier, false);
    case "js-value-from-bool":
      return contract(id, "exact", "js_abi::JsValue::from", "value", boolCarrier, jsValueCarrier, false);
    case "js-value-from-absence":
      return contract(id, "exact", "js_abi::JsValue::from", "value", absenceCarrier, jsValueCarrier, false);
    case "js-value-from-string":
      return contract(id, "exact", "js_abi::JsValue::from", "value", stringCarrier, jsValueCarrier, false);
    case "js-value-from-symbol":
      return contract(id, "exact", "js_abi::JsValue::from", "value", symbolCarrier, jsValueCarrier, false);
    case "js-value-from-error":
      return contract(id, "exact", "js_abi::JsValue::from_error", "value", rustJsErrorTargetType(), jsValueCarrier, false);
    case "js-value-clone":
      return contract(id, "exact", "js_abi::clone_js_value", "ref", jsValueCarrier, jsValueCarrier, false);
    case "ts-value-clone":
      return contract(id, "exact", "rt::clone_ts_value", "ref", tsValueCarrier, tsValueCarrier, false);
    case "owned-string-from-borrowed-str":
      return {
        category: "ownership",
        lowering: "owned-string-from-borrowed-str",
        sourceMode: "value",
        source: rustBorrowedStrTargetType(),
        target: stringCarrier,
        fallible: false,
      };
    case "borrowed-str-from-owned-string":
      return {
        category: "ownership",
        lowering: "borrowed-str-from-owned-string",
        sourceMode: "ref",
        source: stringCarrier,
        target: rustBorrowedStrTargetType(),
        fallible: false,
      };
    case "borrowed-str-from-optional-string":
      return {
        category: "ownership",
        lowering: "borrowed-str-from-optional-string",
        sourceMode: "ref",
        source: rustSourceOptionalTargetType(stringCarrier),
        target: rustBorrowedStrTargetType(),
        fallible: false,
      };
  }
  return undefined;
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
  return { category, lowering: "call", path, sourceMode, source, target,
    ...(fallible ? { fallible: true, errorBoundary: "target-runtime" } as const : { fallible: false } as const) };
}

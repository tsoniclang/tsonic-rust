import type {
  RustNonOptionValueConversion,
  RustValueConversionId,
} from "../operations/model.js";

function semanticConversion(
  id: RustValueConversionId,
): RustNonOptionValueConversion {
  return Object.freeze({ kind: "semantic-conversion", id });
}

export const rustInt32ToUsizeValueConversion = semanticConversion("checked-i32-to-usize");
export const rustInt32ToUint8ValueConversion = semanticConversion("checked-i32-to-u8");
export const rustUsizeToInt32ValueConversion = semanticConversion("checked-usize-to-i32");
export const rustIsizeToInt32ValueConversion = semanticConversion("checked-isize-to-i32");
export const rustUint32ToInt32ValueConversion = semanticConversion("checked-u32-to-i32");
export const rustUint8ToInt32ValueConversion = semanticConversion("exact-u8-to-i32");
export const rustInt32ToFloat64ValueConversion = semanticConversion("exact-i32-to-f64");
export const rustFloat64ToInt32ValueConversion = semanticConversion("checked-f64-to-i32-trunc");
export const rustIsizeToFloat64ValueConversion = semanticConversion("js-number-from-isize");
export const rustUsizeToFloat64ValueConversion = semanticConversion("js-number-from-usize");
export const rustUint64ToFloat64ValueConversion = semanticConversion("js-number-from-u64");
export const rustBoolToJsValueConversion = semanticConversion("js-value-from-bool");
export const rustFloat64ToJsValueConversion = semanticConversion("js-value-from-f64");
export const rustInt32ToJsValueConversion = semanticConversion("js-value-from-i32");
export const rustNullToJsValueConversion = semanticConversion("js-value-from-null");
export const rustStringToJsValueConversion = semanticConversion("js-value-from-string");
export const rustSymbolToJsValueConversion = semanticConversion("js-value-from-symbol");
export const rustUndefinedToJsValueConversion = semanticConversion("js-value-from-undefined");
export const rustJsValueCloneConversion = semanticConversion("js-value-clone");
export const rustTsValueCloneConversion = semanticConversion("ts-value-clone");
export const rustBorrowedStrToStringValueConversion = semanticConversion("owned-string-from-borrowed-str");

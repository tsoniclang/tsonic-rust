import type {
  RustValueConversion,
  RustValueConversionId,
} from "../operations/model.js";

function semanticConversion(
  id: RustValueConversionId,
): RustValueConversion {
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
export const rustJsStringToJsValueConversion = semanticConversion("js-value-from-string");
export const rustJsValueCloneConversion = semanticConversion("js-value-clone");
export const rustJsRegExpExecToMatchConversion = semanticConversion("js-regexp-exec-to-match");
export const rustBorrowedStrToStringValueConversion = semanticConversion("owned-string-from-borrowed-str");

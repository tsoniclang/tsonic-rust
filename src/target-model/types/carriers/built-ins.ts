import { rustJsArrayEntriesTargetId } from "./array-entries.js";
import { rustJsArrayValueTargetId } from "./array-values.js";
import { rustMutableJsErrorTargetId, rustSourceErrorTargetId, rustWritableSourceErrorTargetId, rustRetainedErrorTargetId, rustWritableRetainedErrorTargetId } from "./source-error.js";
import * as nativeIds from "./source-types.js";

export interface RustBuiltInCarrierDefinition {
  readonly renderPath: string | undefined;
  readonly parameters: readonly ("type" | "lifetime")[];
  readonly storage: "arguments" | "opaque" | "program-error" | "unavailable";
}

function nativeCarrier(
  renderPath: string | undefined,
  parameters: readonly ("type" | "lifetime")[],
  storage: RustBuiltInCarrierDefinition["storage"],
): RustBuiltInCarrierDefinition {
  return Object.freeze({ renderPath, parameters: Object.freeze(parameters), storage });
}

export const rustBuiltInCarrierDefinitions: Readonly<Record<string, RustBuiltInCarrierDefinition>> = Object.freeze({
  [nativeIds.rustAbsenceTargetId]: nativeCarrier(undefined, [], "arguments"),
  [nativeIds.rustStringTargetId]: nativeCarrier(undefined, [], "arguments"),
  [nativeIds.rustStrTargetId]: nativeCarrier(undefined, [], "arguments"),
  [nativeIds.rustNativeScalarTargetId]: nativeCarrier(undefined, [], "unavailable"),
  [nativeIds.rustJsStringTargetId]: nativeCarrier("js_abi::JsString", [], "arguments"),
  [nativeIds.rustBigIntTargetId]: nativeCarrier("rt::BigInt", [], "arguments"),
  [nativeIds.rustOptionTargetId]: nativeCarrier("Option", ["type"], "arguments"),
  [nativeIds.rustLocationTargetId]: nativeCarrier("rt::Location", ["type","type"], "arguments"),
  [nativeIds.rustInfallibleTargetId]: nativeCarrier("core::convert::Infallible", [], "arguments"),
  [nativeIds.rustRawPointerTargetId]: nativeCarrier("rt::RawPointer", [], "arguments"),
  [nativeIds.rustCallableTargetId]: nativeCarrier(undefined, ["lifetime","type","type","type"], "arguments"),
  [nativeIds.rustCallableInputTargetId]: nativeCarrier(undefined, ["type","type"], "opaque"),
  [nativeIds.rustGeneratorTargetId]: nativeCarrier("rt::Generator", ["type","type","type"], "arguments"),
  [nativeIds.rustAsyncGeneratorTargetId]: nativeCarrier("rt::AsyncGenerator", ["type","type","type"], "arguments"),
  [nativeIds.rustBorrowedGeneratorTargetId]: nativeCarrier("rt::BorrowedGenerator", ["lifetime","type","type","type"], "arguments"),
  [nativeIds.rustBorrowedAsyncGeneratorTargetId]: nativeCarrier("rt::BorrowedAsyncGenerator", ["lifetime","type","type","type"], "arguments"),
  [nativeIds.rustIteratorResultTargetId]: nativeCarrier("rt::IteratorResult", ["type","type"], "arguments"),
  [nativeIds.rustJsErrorTargetId]: nativeCarrier("rt::JsError", [], "arguments"),
  [nativeIds.rustProgramErrorTargetId]: nativeCarrier("rt::TsonicError", [], "program-error"),
  [nativeIds.rustTsValueTargetId]: nativeCarrier("rt::TsValue", [], "arguments"),
  [nativeIds.rustJsValueTargetId]: nativeCarrier("js_abi::JsValue", [], "arguments"),
  [nativeIds.rustEmptyObjectTargetId]: nativeCarrier("tsonic_rust_runtime::EmptyObject", [], "arguments"),
  [nativeIds.rustObjectIdentityTargetId]: nativeCarrier("tsonic_rust_runtime::EmptyObject", [], "arguments"),
  [nativeIds.rustJsNumericTargetId]: nativeCarrier("js_abi::JsNumeric", [], "arguments"),
  [nativeIds.rustJsStringNumberTargetId]: nativeCarrier("js_abi::JsStringNumber", [], "arguments"),
  [nativeIds.rustJsArrayTargetId]: nativeCarrier("js_abi::JsArray", ["type"], "arguments"),
  [nativeIds.rustJsArrayConcatItemTargetId]: nativeCarrier("js_abi::JsArrayConcatItem", ["type"], "arguments"),
  [nativeIds.rustJsMapTargetId]: nativeCarrier("js_abi::JsMap", ["type","type"], "arguments"),
  [nativeIds.rustJsSetTargetId]: nativeCarrier("js_abi::JsSet", ["type"], "arguments"),
  [nativeIds.rustJsDateTargetId]: nativeCarrier("js_abi::JsDate", [], "arguments"),
  [nativeIds.rustJsSymbolTargetId]: nativeCarrier("js_abi::JsSymbol", [], "arguments"),
  [nativeIds.rustJsWeakMapTargetId]: nativeCarrier("js_abi::JsWeakMap", ["type","type"], "arguments"),
  [nativeIds.rustJsWeakSetTargetId]: nativeCarrier("js_abi::JsWeakSet", ["type"], "arguments"),
  [nativeIds.rustJsPromiseTargetId]: nativeCarrier("js_abi::JsPromise", ["type"], "arguments"),
  [nativeIds.rustJsPromiseResolutionTargetId]: nativeCarrier("js_abi::PromiseResolution", ["type"], "arguments"),
  [nativeIds.rustJsPromiseFulfilledResultTargetId]: nativeCarrier("js_abi::PromiseFulfilledResult", ["type"], "arguments"),
  [nativeIds.rustJsPromiseRejectedResultTargetId]: nativeCarrier("js_abi::PromiseRejectedResult", [], "arguments"),
  [nativeIds.rustJsPromiseSettledResultTargetId]: nativeCarrier("js_abi::PromiseSettledResult", ["type"], "arguments"),
  [nativeIds.rustJsArrayBufferTargetId]: nativeCarrier("js_abi::ArrayBuffer", [], "arguments"),
  [nativeIds.rustJsDataViewTargetId]: nativeCarrier("js_abi::DataView", [], "arguments"),
  [nativeIds.rustJsInt8ArrayTargetId]: nativeCarrier("js_abi::Int8Array", [], "arguments"),
  [nativeIds.rustJsUint8ArrayTargetId]: nativeCarrier("js_abi::Uint8Array", [], "arguments"),
  [nativeIds.rustJsUint8ClampedArrayTargetId]: nativeCarrier("js_abi::Uint8ClampedArray", [], "arguments"),
  [nativeIds.rustJsInt16ArrayTargetId]: nativeCarrier("js_abi::Int16Array", [], "arguments"),
  [nativeIds.rustJsUint16ArrayTargetId]: nativeCarrier("js_abi::Uint16Array", [], "arguments"),
  [nativeIds.rustJsInt32ArrayTargetId]: nativeCarrier("js_abi::Int32Array", [], "arguments"),
  [nativeIds.rustJsUint32ArrayTargetId]: nativeCarrier("js_abi::Uint32Array", [], "arguments"),
  [nativeIds.rustJsFloat32ArrayTargetId]: nativeCarrier("js_abi::Float32Array", [], "arguments"),
  [nativeIds.rustJsFloat64ArrayTargetId]: nativeCarrier("js_abi::Float64Array", [], "arguments"),
  [nativeIds.rustJsIntlDateTimeFormatTargetId]: nativeCarrier("js_abi::IntlDateTimeFormat", [], "arguments"),
  [nativeIds.rustJsIntlNumberFormatTargetId]: nativeCarrier("js_abi::IntlNumberFormat", [], "arguments"),
  [nativeIds.rustJsIntlCollatorTargetId]: nativeCarrier("js_abi::IntlCollator", [], "arguments"),
  [nativeIds.rustJsIntlDateTimeFormatPartTargetId]: nativeCarrier("js_abi::IntlDateTimeFormatPart", [], "arguments"),
  [nativeIds.rustJsIntlNumberFormatPartTargetId]: nativeCarrier("js_abi::IntlNumberFormatPart", [], "arguments"),
  [nativeIds.rustJsIntlGroupingTargetId]: nativeCarrier("js_abi::IntlGrouping", [], "arguments"),
  [nativeIds.rustJsIntlResolvedDateTimeFormatOptionsTargetId]: nativeCarrier("js_abi::IntlResolvedDateTimeFormatOptions", [], "arguments"),
  [nativeIds.rustJsIntlResolvedNumberFormatOptionsTargetId]: nativeCarrier("js_abi::IntlResolvedNumberFormatOptions", [], "arguments"),
  [nativeIds.rustJsIntlResolvedCollatorOptionsTargetId]: nativeCarrier("js_abi::IntlResolvedCollatorOptions", [], "arguments"),
  [nativeIds.rustJsRegExpTargetId]: nativeCarrier("js_abi::JsRegExp", [], "arguments"),
  [nativeIds.rustRegExpExecArrayTargetId]: nativeCarrier("js_abi::RegExpExecArray", [], "arguments"),
  [nativeIds.rustRegExpMatchArrayTargetId]: nativeCarrier("js_abi::RegExpMatchArray", [], "arguments"),
  [nativeIds.rustRegExpIndicesTargetId]: nativeCarrier("js_abi::RegExpIndices", [], "arguments"),
  [nativeIds.rustRegExpNamedGroupsTargetId]: nativeCarrier("js_abi::RegExpNamedGroups", [], "arguments"),
  [nativeIds.rustRegExpNamedIndicesTargetId]: nativeCarrier("js_abi::RegExpNamedIndices", [], "arguments"),
  [nativeIds.rustRegExpStringIteratorTargetId]: nativeCarrier("js_abi::RegExpStringIterator", [], "arguments"),
  [nativeIds.rustJsRegExpExecArrayTargetId]: nativeCarrier("js_abi::JsRegExpExecArray", [], "arguments"),
  [nativeIds.rustJsRegExpMatchArrayTargetId]: nativeCarrier("js_abi::JsRegExpMatchArray", [], "arguments"),
  [nativeIds.rustJsRegExpIndicesTargetId]: nativeCarrier("js_abi::JsRegExpIndices", [], "arguments"),
  [nativeIds.rustJsRegExpNamedGroupsTargetId]: nativeCarrier("js_abi::JsRegExpNamedGroups", [], "arguments"),
  [nativeIds.rustJsRegExpNamedIndicesTargetId]: nativeCarrier("js_abi::JsRegExpNamedIndices", [], "arguments"),
  [nativeIds.rustJsRegExpStringIteratorTargetId]: nativeCarrier("js_abi::JsRegExpStringIterator", [], "arguments"),
  [rustSourceErrorTargetId]: nativeCarrier("rt::SourceError", [], "arguments"),
  [rustWritableSourceErrorTargetId]: nativeCarrier("rt::WritableSourceError", [], "arguments"),
  [rustMutableJsErrorTargetId]: nativeCarrier("rt::MutableJsError", [], "arguments"),
  [rustRetainedErrorTargetId]: nativeCarrier("tsonic_rust_runtime::RetainedError", [], "arguments"),
  [rustWritableRetainedErrorTargetId]: nativeCarrier("tsonic_rust_runtime::WritableRetainedError", [], "arguments"),
  [rustJsArrayValueTargetId]: nativeCarrier("js_abi::JsArrayValue", [], "arguments"),
  [rustJsArrayEntriesTargetId]: nativeCarrier("js_abi::JsArrayEntries", ["type"], "arguments"),
});

const rustBuiltInTargetCarrierIds: ReadonlySet<string> = new Set([
  nativeIds.rustStringTargetId,
  nativeIds.rustStrTargetId,
  nativeIds.rustCallableTargetId,
  ...Object.entries(rustBuiltInCarrierDefinitions).filter(([, definition]) => definition.renderPath !== undefined)
    .map(([id]) => id),
]);

export function isRustBuiltInTargetCarrierId(id: string): boolean {
  return rustBuiltInTargetCarrierIds.has(id);
}

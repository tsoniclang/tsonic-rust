import {
  rustFixedArrayCarrierValue,
  rustJsArrayBufferTargetType,
  rustJsDataViewTargetType,
  rustJsDateTargetType,
  rustJsErrorTargetType,
  rustJsIntlCollatorTargetType,
  rustJsIntlDateTimeFormatTargetType,
  rustJsIntlNumberFormatTargetType,
  rustJsMapTargetType,
  rustJsRegExpTargetType,
  rustJsSetTargetType,
  rustJsTypedArrayTargetType,
  rustJsWeakMapTargetType,
  rustJsWeakSetTargetType,
  rustCarrierSupportsObjectIdentity,
} from "../../../target-model/types/index.js";
import { resolveCarrierRef } from "./selection.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { JsCarrierRef, JsOperationSelection } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustJsTypedArrayName } from "../../../target-model/types/index.js";

type JsConstructorResult =
  | { readonly kind: "map" }
  | { readonly kind: "set" }
  | { readonly kind: "weak-map" }
  | { readonly kind: "weak-set" }
  | { readonly kind: "date" }
  | { readonly kind: "regexp" }
  | { readonly kind: "array-buffer" }
  | { readonly kind: "data-view" }
  | { readonly kind: "typed-array"; readonly name: RustJsTypedArrayName }
  | { readonly kind: "intl-date-time" }
  | { readonly kind: "intl-number" }
  | { readonly kind: "intl-collator" };

interface JsConstructorRowData {
  readonly className: string;
  readonly sourceOwnerName: string;
  readonly typeArgumentCount: number;
  readonly argumentCount: number;
  readonly path: string;
  readonly result: JsConstructorResult;
  readonly fallible?: true;
  readonly params?: readonly (JsCarrierRef | undefined)[];
  readonly argModes?: readonly ("value" | "ref" | "mut-ref")[];
  readonly inputShape?: "js-array-of-element" | "fixed-array-of-element";
  readonly trailingArguments?: readonly ({ readonly kind: "float64"; readonly value: number } | { readonly kind: "none" })[];
  readonly requiresObjectIdentityTypeArgument?: number;
  readonly variant?: string;
}

const typedArrayNames: readonly RustJsTypedArrayName[] = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
];

function typedArrayConstructorRows(name: RustJsTypedArrayName): readonly JsConstructorRowData[] {
  const result = { kind: "typed-array", name } as const;
  const path = `js_abi::${name}`;
  return [
    { className: name, sourceOwnerName: `${name}Constructor`, typeArgumentCount: 0, argumentCount: 1, path: `${path}::new`, result, fallible: true, params: [{ ref: "float64" }], variant: "length" },
    { className: name, sourceOwnerName: `${name}Constructor`, typeArgumentCount: 0, argumentCount: 1, path: `${path}::from_array`, result, fallible: true, params: [{ ref: "float64-array" }], argModes: ["ref"], variant: "array" },
    { className: name, sourceOwnerName: `${name}Constructor`, typeArgumentCount: 0, argumentCount: 1, path: `${path}::from_buffer_only`, result, fallible: true, params: [{ ref: "array-buffer" }], variant: "buffer" },
    { className: name, sourceOwnerName: `${name}Constructor`, typeArgumentCount: 0, argumentCount: 2, path: `${path}::from_buffer_offset`, result, fallible: true, params: [{ ref: "array-buffer" }, { ref: "float64" }], variant: "buffer-offset" },
    { className: name, sourceOwnerName: `${name}Constructor`, typeArgumentCount: 0, argumentCount: 3, path: `${path}::from_buffer_length`, result, fallible: true, params: [{ ref: "array-buffer" }, { ref: "float64" }, { ref: "float64" }], variant: "buffer-offset-length" },
  ];
}

function intlConstructorRows(
  className: "Intl.DateTimeFormat" | "Intl.NumberFormat" | "Intl.Collator",
  sourceOwnerName: "IntlDateTimeFormatConstructor" | "IntlNumberFormatConstructor" | "IntlCollatorConstructor",
  result: Extract<JsConstructorResult, { readonly kind: `intl-${string}` }>,
  path: string,
): readonly JsConstructorRowData[] {
  return [
    { className, sourceOwnerName, typeArgumentCount: 0, argumentCount: 0, path: `${path}::new`, result },
    { className, sourceOwnerName, typeArgumentCount: 0, argumentCount: 1, path: `${path}::with_locale`, result, fallible: true, params: [{ ref: "string" }], argModes: ["ref"], variant: "locale" },
    { className, sourceOwnerName, typeArgumentCount: 0, argumentCount: 1, path: `${path}::with_locales`, result, fallible: true, params: [{ ref: "string-array" }], argModes: ["ref"], variant: "locales" },
    { className, sourceOwnerName, typeArgumentCount: 0, argumentCount: 2, path: `${path}::with_locale_options`, result, fallible: true, params: [{ ref: "string" }, { ref: "jsvalue" }], argModes: ["ref", "ref"], variant: "locale-options" },
    { className, sourceOwnerName, typeArgumentCount: 0, argumentCount: 2, path: `${path}::with_locales_options`, result, fallible: true, params: [{ ref: "string-array" }, { ref: "jsvalue" }], argModes: ["ref", "ref"], variant: "locales-options" },
  ];
}

const jsConstructorRows: readonly JsConstructorRowData[] = [
  { className: "Map", sourceOwnerName: "MapConstructor", typeArgumentCount: 2, argumentCount: 0, path: "js_abi::JsMap::new", result: { kind: "map" } },
  { className: "Set", sourceOwnerName: "SetConstructor", typeArgumentCount: 1, argumentCount: 0, path: "js_abi::JsSet::new", result: { kind: "set" } },
  { className: "Set", sourceOwnerName: "SetConstructor", typeArgumentCount: 1, argumentCount: 1, path: "js_abi::JsSet::from_array", result: { kind: "set" }, params: [{ ref: "element-array" }], argModes: ["ref"], inputShape: "js-array-of-element", variant: "js-array" },
  { className: "Set", sourceOwnerName: "SetConstructor", typeArgumentCount: 1, argumentCount: 1, path: "js_abi::JsSet::from_fixed_array", result: { kind: "set" }, argModes: ["ref"], inputShape: "fixed-array-of-element", variant: "fixed-array" },
  { className: "WeakMap", sourceOwnerName: "WeakMapConstructor", typeArgumentCount: 2, argumentCount: 0, path: "js_abi::JsWeakMap::new", result: { kind: "weak-map" }, requiresObjectIdentityTypeArgument: 0 },
  { className: "WeakMap", sourceOwnerName: "WeakMapConstructor", typeArgumentCount: 2, argumentCount: 1, path: "js_abi::JsWeakMap::from_null", result: { kind: "weak-map" }, params: [{ ref: "null" }], requiresObjectIdentityTypeArgument: 0, variant: "null" },
  { className: "WeakMap", sourceOwnerName: "WeakMapConstructor", typeArgumentCount: 2, argumentCount: 1, path: "js_abi::JsWeakMap::from_array", result: { kind: "weak-map" }, params: [{ ref: "weak-map-entry-array" }], argModes: ["ref"], requiresObjectIdentityTypeArgument: 0, variant: "array" },
  { className: "WeakSet", sourceOwnerName: "WeakSetConstructor", typeArgumentCount: 1, argumentCount: 0, path: "js_abi::JsWeakSet::new", result: { kind: "weak-set" }, requiresObjectIdentityTypeArgument: 0 },
  { className: "WeakSet", sourceOwnerName: "WeakSetConstructor", typeArgumentCount: 1, argumentCount: 1, path: "js_abi::JsWeakSet::from_null", result: { kind: "weak-set" }, params: [{ ref: "null" }], requiresObjectIdentityTypeArgument: 0, variant: "null" },
  { className: "WeakSet", sourceOwnerName: "WeakSetConstructor", typeArgumentCount: 1, argumentCount: 1, path: "js_abi::JsWeakSet::from_array", result: { kind: "weak-set" }, params: [{ ref: "weak-key-array" }], argModes: ["ref"], requiresObjectIdentityTypeArgument: 0, variant: "array" },
  { className: "Date", sourceOwnerName: "DateConstructor", typeArgumentCount: 0, argumentCount: 0, path: "js_abi::JsDate::new", result: { kind: "date" } },
  { className: "Date", sourceOwnerName: "DateConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::JsDate::from_millis", result: { kind: "date" }, params: [{ ref: "float64" }] },
  { className: "Date", sourceOwnerName: "DateConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::JsDate::from_string", result: { kind: "date" }, params: [{ ref: "string" }], argModes: ["ref"] },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 0, path: "js_abi::regexp_empty_native", result: { kind: "regexp" }, fallible: true, variant: "empty" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::regexp_from_string_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "string" }], argModes: ["ref"], variant: "native" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::regexp_from_exact", result: { kind: "regexp" }, fallible: true, params: [{ ref: "js-string" }], argModes: ["ref"], variant: "exact" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::regexp_from_undefined_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "undefined" }], variant: "undefined" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::regexp_construct_from_regexp_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "regexp" }], argModes: ["ref"], variant: "regexp" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_string_with_flags_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "string" }, { ref: "string" }], argModes: ["ref", "ref"], variant: "native-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_string_with_undefined_flags_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "string" }, { ref: "undefined" }], argModes: ["ref", "value"], variant: "native-undefined-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_exact_with_flags", result: { kind: "regexp" }, fallible: true, params: [{ ref: "js-string" }, { ref: "string" }], argModes: ["ref", "ref"], variant: "exact-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_exact_with_undefined_flags", result: { kind: "regexp" }, fallible: true, params: [{ ref: "js-string" }, { ref: "undefined" }], argModes: ["ref", "value"], variant: "exact-undefined-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_undefined_with_flags_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "undefined" }, { ref: "string" }], argModes: ["value", "ref"], variant: "undefined-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_undefined_with_undefined_flags_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "undefined" }, { ref: "undefined" }], variant: "undefined-undefined-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_construct_from_regexp_with_flags_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "regexp" }, { ref: "string" }], argModes: ["ref", "ref"], variant: "regexp-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_construct_from_regexp_with_undefined_flags_native", result: { kind: "regexp" }, fallible: true, params: [{ ref: "regexp" }, { ref: "undefined" }], argModes: ["ref", "value"], variant: "regexp-undefined-flags" },
  { className: "ArrayBuffer", sourceOwnerName: "ArrayBufferConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::ArrayBuffer::new", result: { kind: "array-buffer" }, fallible: true, params: [{ ref: "float64" }] },
  { className: "DataView", sourceOwnerName: "DataViewConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::DataView::from_buffer", result: { kind: "data-view" }, fallible: true, params: [{ ref: "array-buffer" }] },
  { className: "DataView", sourceOwnerName: "DataViewConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::DataView::from_buffer_offset", result: { kind: "data-view" }, fallible: true, params: [{ ref: "array-buffer" }, { ref: "float64" }], variant: "offset" },
  { className: "DataView", sourceOwnerName: "DataViewConstructor", typeArgumentCount: 0, argumentCount: 3, path: "js_abi::DataView::from_buffer_length", result: { kind: "data-view" }, fallible: true, params: [{ ref: "array-buffer" }, { ref: "float64" }, { ref: "float64" }], variant: "offset-length" },
  ...typedArrayNames.flatMap(typedArrayConstructorRows),
  ...intlConstructorRows("Intl.DateTimeFormat", "IntlDateTimeFormatConstructor", { kind: "intl-date-time" }, "js_abi::IntlDateTimeFormat"),
  ...intlConstructorRows("Intl.NumberFormat", "IntlNumberFormatConstructor", { kind: "intl-number" }, "js_abi::IntlNumberFormat"),
  ...intlConstructorRows("Intl.Collator", "IntlCollatorConstructor", { kind: "intl-collator" }, "js_abi::IntlCollator"),
];

export interface JsConstructorRequest {
  readonly className: string;
  readonly typeArgumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly argumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly carrierSupportsProjectIdentity?: (carrier: TargetTypeRef) => boolean;
}

function resolveConstructorResult(
  result: JsConstructorResult,
  typeArguments: readonly (TargetTypeRef | undefined)[],
): TargetTypeRef | undefined {
  switch (result.kind) {
    case "map": {
      const [key, value] = typeArguments;
      return key === undefined || value === undefined ? undefined : rustJsMapTargetType(key, value);
    }
    case "set": {
      const [value] = typeArguments;
      return value === undefined ? undefined : rustJsSetTargetType(value);
    }
    case "weak-map": {
      const [key, value] = typeArguments;
      return key === undefined || value === undefined ? undefined : rustJsWeakMapTargetType(key, value);
    }
    case "weak-set": {
      const [value] = typeArguments;
      return value === undefined ? undefined : rustJsWeakSetTargetType(value);
    }
    case "date": return rustJsDateTargetType();
    case "regexp": return rustJsRegExpTargetType();
    case "array-buffer": return rustJsArrayBufferTargetType();
    case "data-view": return rustJsDataViewTargetType();
    case "typed-array": return rustJsTypedArrayTargetType(result.name);
    case "intl-date-time": return rustJsIntlDateTimeFormatTargetType();
    case "intl-number": return rustJsIntlNumberFormatTargetType();
    case "intl-collator": return rustJsIntlCollatorTargetType();
  }
}

export function selectJsSurfaceConstructor(request: JsConstructorRequest): JsOperationSelection | undefined {
  const rows = jsConstructorRows.filter((candidate) =>
    candidate.className === request.className &&
    candidate.typeArgumentCount === request.typeArgumentCarriers.length &&
    candidate.argumentCount === request.argumentCarriers.length);
  if (rows.length === 0) {
    return undefined;
  }
  const typeArguments = request.typeArgumentCarriers;
  const resultCarrier = resolveConstructorResult(rows[0]!.result, typeArguments);
  if (resultCarrier === undefined) {
    return undefined;
  }
  const matches = rows.flatMap((row) => {
    const identityArgument = row.requiresObjectIdentityTypeArgument === undefined
      ? undefined
      : typeArguments[row.requiresObjectIdentityTypeArgument];
    if (row.requiresObjectIdentityTypeArgument !== undefined &&
      (identityArgument === undefined ||
        (!rustCarrierSupportsObjectIdentity(identityArgument) &&
          request.carrierSupportsProjectIdentity?.(identityArgument) !== true))) {
      return [];
    }
    let parameterCarriers = (row.params ?? []).map((reference) =>
      reference === undefined ? undefined : resolveCarrierRef(reference, {
        element: typeArguments[0],
        setValue: typeArguments[0],
      }));
    if (row.inputShape === "fixed-array-of-element") {
      const actual = request.argumentCarriers[0];
      const fixed = rustFixedArrayCarrierValue(actual);
      if (actual === undefined || fixed === undefined || typeArguments[0] === undefined ||
        !rustTargetTypeRefEquals(fixed.element, typeArguments[0])) {
        return [];
      }
      parameterCarriers = [actual];
    }
    if (parameterCarriers.some((carrier, index) =>
      carrier === undefined || request.argumentCarriers[index] === undefined ||
      !rustTargetTypeRefEquals(carrier, request.argumentCarriers[index]!))) {
      return [];
    }
    return [{ row, parameterCarriers }];
  });
  if (matches.length !== 1) {
    return undefined;
  }
  const { row, parameterCarriers } = matches[0]!;
  return {
    fact: {
      kind: "provider-operation",
      operationId: `tsonic.rust.js.${row.className}.constructor${row.variant === undefined ? "" : `.${row.variant}`}`,
      operationKind: "constructor",
      target: {
        form: "call",
        path: row.path,
        ...(row.argModes === undefined ? {} : { argModes: row.argModes }),
        ...(row.trailingArguments === undefined ? {} : { trailingArguments: row.trailingArguments }),
      },
      resultCarrier,
      parameterCarriers,
      isAsync: false,
      isFallible: row.fallible === true,
      errorBoundary: row.fallible === true ? "provider-native" : "none",
      ...(row.fallible === true ? { errorCarrier: rustJsErrorTargetType() } : {}),
    },
    resultCarrier,
    parameterCarriers,
  };
}

export function selectJsSurfaceConstructorBySourceOwner(request: {
  readonly sourceOwnerName: string;
  readonly typeArgumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly argumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly carrierSupportsProjectIdentity?: (carrier: TargetTypeRef) => boolean;
}): JsOperationSelection | undefined {
  const row = jsConstructorRows.find((candidate) => candidate.sourceOwnerName === request.sourceOwnerName);
  return row === undefined
    ? undefined
    : selectJsSurfaceConstructor({
        className: row.className,
        typeArgumentCarriers: request.typeArgumentCarriers,
        argumentCarriers: request.argumentCarriers,
        ...(request.carrierSupportsProjectIdentity === undefined
          ? {}
          : { carrierSupportsProjectIdentity: request.carrierSupportsProjectIdentity }),
      });
}

import {
  rustFixedArrayCarrierValue,
  rustJsDateTargetType,
  rustJsErrorTargetType,
  rustJsMapTargetType,
  rustJsRegExpTargetType,
  rustJsSetTargetType,
} from "../../../target-model/types/index.js";
import { resolveCarrierRef } from "./selection.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { JsCarrierRef, JsOperationSelection } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

interface JsConstructorRowData {
  readonly className: string;
  readonly sourceOwnerName: string;
  readonly typeArgumentCount: number;
  readonly argumentCount: number;
  readonly path: string;
  readonly result: "map" | "set" | "date" | "regexp";
  readonly fallible?: true;
  readonly params?: readonly (JsCarrierRef | undefined)[];
  readonly argModes?: readonly ("value" | "ref" | "mut-ref")[];
  readonly inputShape?: "js-array-of-element" | "fixed-array-of-element";
  readonly variant?: string;
}

const jsConstructorRows: readonly JsConstructorRowData[] = [
  { className: "Map", sourceOwnerName: "MapConstructor", typeArgumentCount: 2, argumentCount: 0, path: "js_abi::JsMap::new", result: "map" },
  { className: "Set", sourceOwnerName: "SetConstructor", typeArgumentCount: 1, argumentCount: 0, path: "js_abi::JsSet::new", result: "set" },
  { className: "Set", sourceOwnerName: "SetConstructor", typeArgumentCount: 1, argumentCount: 1, path: "js_abi::JsSet::from_array", result: "set", params: [{ ref: "element-array" }], argModes: ["ref"], inputShape: "js-array-of-element", variant: "js-array" },
  { className: "Set", sourceOwnerName: "SetConstructor", typeArgumentCount: 1, argumentCount: 1, path: "js_abi::JsSet::from_fixed_array", result: "set", argModes: ["ref"], inputShape: "fixed-array-of-element", variant: "fixed-array" },
  { className: "Date", sourceOwnerName: "DateConstructor", typeArgumentCount: 0, argumentCount: 0, path: "js_abi::JsDate::new", result: "date" },
  { className: "Date", sourceOwnerName: "DateConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::JsDate::from_millis", result: "date", params: [{ ref: "float64" }] },
  { className: "Date", sourceOwnerName: "DateConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::JsDate::from_string", result: "date", params: [{ ref: "string" }], argModes: ["ref"] },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 0, path: "js_abi::regexp_empty_native", result: "regexp", fallible: true, variant: "empty" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::regexp_from_string_native", result: "regexp", fallible: true, params: [{ ref: "string" }], argModes: ["ref"], variant: "native" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::regexp_from_exact", result: "regexp", fallible: true, params: [{ ref: "js-string" }], argModes: ["ref"], variant: "exact" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::regexp_from_undefined_native", result: "regexp", fallible: true, params: [{ ref: "undefined" }], variant: "undefined" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::regexp_construct_from_regexp_native", result: "regexp", fallible: true, params: [{ ref: "regexp" }], argModes: ["ref"], variant: "regexp" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_string_with_flags_native", result: "regexp", fallible: true, params: [{ ref: "string" }, { ref: "string" }], argModes: ["ref", "ref"], variant: "native-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_string_with_undefined_flags_native", result: "regexp", fallible: true, params: [{ ref: "string" }, { ref: "undefined" }], argModes: ["ref", "value"], variant: "native-undefined-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_exact_with_flags", result: "regexp", fallible: true, params: [{ ref: "js-string" }, { ref: "string" }], argModes: ["ref", "ref"], variant: "exact-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_exact_with_undefined_flags", result: "regexp", fallible: true, params: [{ ref: "js-string" }, { ref: "undefined" }], argModes: ["ref", "value"], variant: "exact-undefined-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_undefined_with_flags_native", result: "regexp", fallible: true, params: [{ ref: "undefined" }, { ref: "string" }], argModes: ["value", "ref"], variant: "undefined-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_from_undefined_with_undefined_flags_native", result: "regexp", fallible: true, params: [{ ref: "undefined" }, { ref: "undefined" }], variant: "undefined-undefined-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_construct_from_regexp_with_flags_native", result: "regexp", fallible: true, params: [{ ref: "regexp" }, { ref: "string" }], argModes: ["ref", "ref"], variant: "regexp-flags" },
  { className: "RegExp", sourceOwnerName: "RegExpConstructor", typeArgumentCount: 0, argumentCount: 2, path: "js_abi::regexp_construct_from_regexp_with_undefined_flags_native", result: "regexp", fallible: true, params: [{ ref: "regexp" }, { ref: "undefined" }], argModes: ["ref", "value"], variant: "regexp-undefined-flags" },
];

export interface JsConstructorRequest {
  readonly className: string;
  readonly typeArgumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly argumentCarriers: readonly (TargetTypeRef | undefined)[];
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
  let resultCarrier: TargetTypeRef | undefined;
  if (rows[0]!.result === "map") {
    const [key, value] = typeArguments;
    resultCarrier = key !== undefined && value !== undefined ? rustJsMapTargetType(key, value) : undefined;
  } else if (rows[0]!.result === "set") {
    const [value] = typeArguments;
    resultCarrier = value !== undefined ? rustJsSetTargetType(value) : undefined;
  } else if (rows[0]!.result === "date") {
    resultCarrier = rustJsDateTargetType();
  } else {
    resultCarrier = rustJsRegExpTargetType();
  }
  if (resultCarrier === undefined) {
    return undefined;
  }
  const matches = rows.flatMap((row) => {
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
      target: { form: "call", path: row.path, ...(row.argModes === undefined ? {} : { argModes: row.argModes }) },
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
}): JsOperationSelection | undefined {
  const row = jsConstructorRows.find((candidate) => candidate.sourceOwnerName === request.sourceOwnerName);
  return row === undefined
    ? undefined
    : selectJsSurfaceConstructor({
        className: row.className,
        typeArgumentCarriers: request.typeArgumentCarriers,
        argumentCarriers: request.argumentCarriers,
      });
}

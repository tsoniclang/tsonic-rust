import type { TargetTypeRef } from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type {
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustRuntimeSetTemplate,
  RustValueConversion,
} from "../rust-facts/keys.js";
import { rustSourceTypeCarrierValue } from "../rust-facts/keys.js";
import {
  rustInt32ToFloat64ValueConversion,
  rustInt32ToUsizeValueConversion,
  rustIsizeToFloat64ValueConversion,
  rustIsizeToInt32ValueConversion,
  rustUsizeToInt32ValueConversion,
} from "../rust-facts/value-conversions.js";
import {
  isRustJsArrayCarrier,
  isRustBoolCarrier,
  isRustIntegerCarrier,
  isRustJsValueCarrier,
  rustJsValueTargetType,
  rustStringTargetId,
  rustVecTargetType,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustJsDateTargetId,
  rustJsDateTargetType,
  rustJsArrayTargetType,
  rustJsMapTargetId,
  rustJsMapTargetType,
  rustJsSetTargetId,
  rustJsSetTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
} from "../rust-target-types.js";

// Declarative JS surface operation rows. Rows are matched by the identity of
// the selected lib declaration (owner interface + member name) and the
// receiver carrier lane; the generic matcher below contains no per-name
// branching. Concrete owner/member spellings and Rust operation shapes exist
// only as row data.

export interface JsOperationRequest {
  readonly ownerName: string;
  readonly memberName: string;
  readonly operationKind: "call" | "property" | "indexer" | "constructor" | "property-set" | "index-set" | "delete";
  readonly receiverCarrier?: TargetTypeRef;
  readonly argumentCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly selectedMethodTypeArgumentCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly argumentCompatibility?: (
    expected: TargetTypeRef,
    actual: TargetTypeRef | undefined,
    index: number,
  ) => number | undefined;
}

export interface JsOperationSelection {
  readonly fact: RustProviderOperationTemplate | RustRuntimeSetTemplate;
  readonly resultCarrier?: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly callbackShape?: "map" | "reduce";
}

type JsLane = "js-array" | "string" | "map" | "set" | "date" | "json" | "math" | "number" | "console" | "regexp" | "regexp-match";

type JsCarrierRef =
  | { readonly ref: "cb-predicate" }
  | { readonly ref: "cb-map" }
  | { readonly ref: "cb-reduce" }
  | { readonly ref: "int32" }
  | { readonly ref: "jsvalue" }
  | { readonly ref: "float64" }
  | { readonly ref: "infer" }
  | { readonly ref: "selected-method-type-argument"; readonly index: number }
  | { readonly ref: "bool" }
  | { readonly ref: "unit" }
  | { readonly ref: "string-array" }
  | { readonly ref: "regexp-match" }
  | { readonly ref: "option-of-regexp-match" }
  | { readonly ref: "regexp-match-vec" }
  | { readonly ref: "option-of-string" }
  | { readonly ref: "option-of-string-array" }
  | { readonly ref: "element-array" }
  | { readonly ref: "option-of-float64" }
  | { readonly ref: "string" }
  | { readonly ref: "element" }
  | { readonly ref: "option-of-element" }
  | { readonly ref: "receiver" }
  | { readonly ref: "map-key" }
  | { readonly ref: "map-value" }
  | { readonly ref: "option-of-map-value" }
  | { readonly ref: "set-value" };

interface JsOperationRowData {
  readonly owner: string;
  readonly member: string;
  readonly operationKind: JsOperationRequest["operationKind"];
  readonly lane: JsLane;
  readonly variant?: string;
  readonly elementGuard?: "numeric" | "clone-concrete" | "stringifiable";
  readonly callback?: "map" | "reduce";
  readonly selectedMethodTypeArgumentArity?: number;
  readonly fallible?: boolean;
  readonly variadic?: true;
  readonly firstArgCarrierId?: string;
  readonly shape:
    | {
        readonly op: "operation";
        readonly operationKind: "method" | "constructor" | "property" | "indexer";
        readonly target: RustProviderOperationForm;
        readonly resultConversion?: RustValueConversion;
        readonly result: JsCarrierRef;
        readonly params?: readonly (JsCarrierRef | undefined)[];
        readonly firstArgCarrierId?: string;
}
    | {
        readonly op: "set";
        readonly target: RustProviderOperationForm;
        readonly params: readonly JsCarrierRef[];
      };
}

const zeroArgument = { kind: "integer", value: 0 } as const;
const noneArgument = { kind: "none" } as const;
const numberPredicateRows = [
  { member: "isFinite", path: "js_abi::number_is_finite" },
  { member: "isInteger", path: "js_abi::number_is_integer" },
  { member: "isNaN", path: "js_abi::number_is_nan" },
  { member: "isSafeInteger", path: "js_abi::number_is_safe_integer" },
] as const;
const consoleRows = [
  { member: "log", path: "js_abi::console_log" },
  { member: "error", path: "js_abi::console_error" },
  { member: "warn", path: "js_abi::console_warn" },
  { member: "info", path: "js_abi::console_info" },
  { member: "debug", path: "js_abi::console_debug" },
] as const;

const sharedArrayOwners = ["Array", "ReadonlyArray"] as const;
const sharedArrayOperationRows = sharedArrayOwners.flatMap((owner): readonly JsOperationRowData[] => [
  { owner, member: "length", operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  { owner, member: "at", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "at", argModes: ["value"] }, result: { ref: "option-of-element" }, params: [{ ref: "float64" }] } },
  { owner, member: "includes", operationKind: "call", lane: "js-array", elementGuard: "numeric", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes_from_start", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "element" }] } },
  { owner, member: "indexOf", operationKind: "call", lane: "js-array", elementGuard: "numeric", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of_from_start", argModes: ["ref"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner, member: "index", operationKind: "indexer", lane: "js-array", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get", argModes: ["value"], argConversions: [rustInt32ToUsizeValueConversion] }, result: { ref: "option-of-element" }, params: [{ ref: "int32" }] } },
  { owner, member: "filter", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "filter" }, result: { ref: "receiver" }, params: [{ ref: "cb-predicate" }] } },
  { owner, member: "find", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "find" }, result: { ref: "option-of-element" }, params: [{ ref: "cb-predicate" }] } },
  { owner, member: "findIndex", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "find_index" }, result: { ref: "float64" }, resultConversion: rustIsizeToFloat64ValueConversion, params: [{ ref: "cb-predicate" }] } },
  { owner, member: "findLast", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "find_last" }, result: { ref: "option-of-element" }, params: [{ ref: "cb-predicate" }] } },
  { owner, member: "findLastIndex", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "find_last_index" }, result: { ref: "float64" }, resultConversion: rustIsizeToFloat64ValueConversion, params: [{ ref: "cb-predicate" }] } },
  { owner, member: "some", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "some" }, result: { ref: "bool" }, params: [{ ref: "cb-predicate" }] } },
  { owner, member: "every", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "every" }, result: { ref: "bool" }, params: [{ ref: "cb-predicate" }] } },
  { owner, member: "map", operationKind: "call", lane: "js-array", selectedMethodTypeArgumentArity: 1, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "map" }, result: { ref: "receiver" }, params: [{ ref: "cb-map" }] }, callback: "map" },
  { owner, member: "slice", operationKind: "call", lane: "js-array", variant: "default", elementGuard: "clone-concrete", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_all" }, result: { ref: "element-array" } } },
  { owner, member: "slice", operationKind: "call", lane: "js-array", variant: "start", elementGuard: "clone-concrete", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_from" }, result: { ref: "element-array" }, params: [{ ref: "float64" }] } },
  { owner, member: "slice", operationKind: "call", lane: "js-array", variant: "start-end", elementGuard: "clone-concrete", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_to" }, result: { ref: "element-array" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner, member: "join", operationKind: "call", lane: "js-array", variant: "default", elementGuard: "stringifiable", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "join_default" }, result: { ref: "string" } } },
  { owner, member: "join", operationKind: "call", lane: "js-array", variant: "separator", elementGuard: "stringifiable", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "join", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
]);

const jsOperationRows: readonly JsOperationRowData[] = [
  ...sharedArrayOperationRows,
  { owner: "Array", member: "length", operationKind: "property-set", lane: "js-array", shape: { op: "set", target: { form: "receiver-method", name: "set_len", argConversions: [rustInt32ToUsizeValueConversion] }, params: [{ ref: "int32" }] } },
  { owner: "Array", member: "push", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "push" }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner: "Array", member: "index", operationKind: "index-set", lane: "js-array", shape: { op: "set", target: { form: "receiver-method", name: "set", argConversions: [rustInt32ToUsizeValueConversion, undefined] }, params: [{ ref: "int32" }, { ref: "element" }] } },
  { owner: "Array", member: "index", operationKind: "delete", lane: "js-array", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "delete_at", argConversions: [rustInt32ToUsizeValueConversion] }, result: { ref: "bool" }, params: [{ ref: "int32" }] } },
  { owner: "Array", member: "reduce", operationKind: "call", lane: "js-array", variant: "receiver-element", selectedMethodTypeArgumentArity: 0, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "reduce", argOrder: [1, 0] }, result: { ref: "element" }, params: [{ ref: "cb-reduce" }, { ref: "element" }] }, callback: "reduce" },
  { owner: "Array", member: "reduce", operationKind: "call", lane: "js-array", variant: "selected-accumulator", selectedMethodTypeArgumentArity: 1, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "reduce", argOrder: [1, 0] }, result: { ref: "selected-method-type-argument", index: 0 }, params: [{ ref: "cb-reduce" }, { ref: "selected-method-type-argument", index: 0 }] }, callback: "reduce" },

  // String lane (runtime string module through the js_string alias).
  { owner: "String", member: "length", operationKind: "property", lane: "string", shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_string::js_len", receiverMode: "ref" }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  { owner: "String", member: "includes", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::includes", receiverMode: "ref", argModes: ["ref"], trailingArguments: [zeroArgument] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "startsWith", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::starts_with", receiverMode: "ref", argModes: ["ref"], trailingArguments: [zeroArgument] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "endsWith", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::ends_with", receiverMode: "ref", argModes: ["ref"], trailingArguments: [noneArgument] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "toUpperCase", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_upper_case", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "toLowerCase", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_lower_case", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "trim", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "slice", operationKind: "call", lane: "string", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice", receiverMode: "ref", trailingArguments: [zeroArgument, noneArgument] }, result: { ref: "string" } } },
  { owner: "String", member: "slice", operationKind: "call", lane: "string", variant: "start", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice", receiverMode: "ref", trailingArguments: [noneArgument] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "slice", operationKind: "call", lane: "string", variant: "start-end", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice_to", receiverMode: "ref" }, result: { ref: "string" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "String", member: "codePointAt", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::code_point_at", receiverMode: "ref" }, result: { ref: "option-of-float64" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "repeat", operationKind: "call", lane: "string", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::repeat", receiverMode: "ref" }, result: { ref: "string" }, params: [{ ref: "float64" }] } },

  // Map lane.
  { owner: "Map", member: "set", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "set" }, result: { ref: "receiver" }, params: [{ ref: "map-key" }, { ref: "map-value" }] } },
  { owner: "Map", member: "get", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get", argModes: ["ref"] }, result: { ref: "option-of-map-value" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "has", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "delete", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "size", operationKind: "property", lane: "map", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },

  // Set lane.
  { owner: "Set", member: "add", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "add" }, result: { ref: "receiver" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "has", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "delete", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "size", operationKind: "property", lane: "set", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },

  // JSON lane (static owner; fallible rows require a fallible context).
  { owner: "JSON", member: "parse", operationKind: "call", lane: "json", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::json_parse", argModes: ["ref"] }, result: { ref: "jsvalue" }, params: [{ ref: "string" }] } },
  { owner: "JSON", member: "stringify", operationKind: "call", lane: "json", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::json_stringify", argModes: ["ref"] }, result: { ref: "option-of-string" }, params: [{ ref: "jsvalue" }] } },

  ...consoleRows.map(({ member, path }) => ({
    owner: "Console",
    member,
    operationKind: "call" as const,
    lane: "console" as const,
    variadic: true as const,
    shape: {
      op: "operation" as const,
      operationKind: "method" as const,
      target: {
        form: "call-value-slice" as const,
        path,
        leadingArguments: [],
        elementCarrier: rustJsValueTargetType(),
      },
      result: { ref: "unit" as const },
    },
  })),

  // RegExp match-carrier lane.
  { owner: "RegExpExecArray", member: "index", operationKind: "property", lane: "regexp-match", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "index" }, result: { ref: "float64" }, resultConversion: rustInt32ToFloat64ValueConversion } },
  { owner: "RegExpExecArray", member: "input", operationKind: "property", lane: "regexp-match", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "input" }, result: { ref: "string" } } },
  { owner: "RegExpExecArray", member: "length", operationKind: "property", lane: "regexp-match", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "group_count" }, result: { ref: "int32" }, resultConversion: rustUsizeToInt32ValueConversion } },
  { owner: "RegExpExecArray", member: "index", operationKind: "indexer", lane: "regexp-match", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "group", argModes: ["value"], argConversions: [rustInt32ToUsizeValueConversion] }, result: { ref: "option-of-string" }, params: [{ ref: "int32" }] } },

  // RegExp lane: constant, compile-validated, oracle-proven subset.
  { owner: "RegExp", member: "test", operationKind: "call", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "test", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: "RegExp", member: "exec", operationKind: "call", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "exec", argModes: ["ref"] }, result: { ref: "option-of-regexp-match" }, params: [{ ref: "string" }] } },
  { owner: "RegExp", member: "source", operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "source" }, result: { ref: "string" } } },
  { owner: "RegExp", member: "flags", operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "flags" }, result: { ref: "string" } } },
  { owner: "RegExp", member: "global", operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "global" }, result: { ref: "bool" } } },
  { owner: "RegExp", member: "ignoreCase", operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "ignore_case" }, result: { ref: "bool" } } },
  { owner: "RegExp", member: "multiline", operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "multiline" }, result: { ref: "bool" } } },
  { owner: "RegExp", member: "lastIndex", operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "last_index" }, result: { ref: "float64" }, resultConversion: rustInt32ToFloat64ValueConversion } },
  { owner: "String", member: "indexOf", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::index_of", receiverMode: "ref", argModes: ["ref"], trailingArguments: [zeroArgument] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "charAt", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::char_at", receiverMode: "ref" }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "at", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::at", receiverMode: "ref" }, result: { ref: "option-of-string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "float64-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start", receiverMode: "ref", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "float64-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start_with", receiverMode: "ref", argModes: ["value", "ref"] }, result: { ref: "string" }, params: [{ ref: "float64" }, { ref: "string" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "int32-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start", receiverMode: "ref", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "int32-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start_with", receiverMode: "ref", argModes: ["value", "ref"], argConversions: [rustInt32ToFloat64ValueConversion, undefined] }, result: { ref: "string" }, params: [{ ref: "int32" }, { ref: "string" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "float64-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end", receiverMode: "ref", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "float64-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end_with", receiverMode: "ref", argModes: ["value", "ref"] }, result: { ref: "string" }, params: [{ ref: "float64" }, { ref: "string" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "int32-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end", receiverMode: "ref", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "int32-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end_with", receiverMode: "ref", argModes: ["value", "ref"], argConversions: [rustInt32ToFloat64ValueConversion, undefined] }, result: { ref: "string" }, params: [{ ref: "int32" }, { ref: "string" }] } },
  { owner: "String", member: "trimStart", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim_start", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "trimEnd", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim_end", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "matchAll", operationKind: "call", lane: "string", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "match_all", argModes: ["ref"] }, result: { ref: "regexp-match-vec" }, params: [undefined] } },
  { owner: "String", member: "replace", operationKind: "call", lane: "string", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "replace", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [undefined, { ref: "string" }] } },
  { owner: "String", member: "search", operationKind: "call", lane: "string", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "search", argModes: ["ref"] }, result: { ref: "int32" }, params: [undefined] } },
  { owner: "String", member: "split", operationKind: "call", lane: "string", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "split", argModes: ["ref"] }, result: { ref: "string-array" }, params: [undefined] } },

  // Set algebra.
  { owner: "Set", member: "union", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "union", argModes: ["ref"] }, result: { ref: "receiver" }, params: [{ ref: "receiver" }] } },
  { owner: "Set", member: "intersection", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "intersection", argModes: ["ref"] }, result: { ref: "receiver" }, params: [{ ref: "receiver" }] } },
  { owner: "Set", member: "difference", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "difference", argModes: ["ref"] }, result: { ref: "receiver" }, params: [{ ref: "receiver" }] } },
  { owner: "Set", member: "symmetricDifference", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "symmetric_difference", argModes: ["ref"] }, result: { ref: "receiver" }, params: [{ ref: "receiver" }] } },
  { owner: "Set", member: "isSubsetOf", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "is_subset_of", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "receiver" }] } },
  { owner: "Set", member: "isSupersetOf", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "is_superset_of", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "receiver" }] } },
  { owner: "Set", member: "isDisjointFrom", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "is_disjoint_from", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "receiver" }] } },

  // Math lane: only operations whose Rust f64 semantics equal JS exactly
  // (NaN-sensitive min/max and half-up round need runtime helpers and stay
  // out of this closed set).
  { owner: "Math", member: "floor", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "floor" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "ceil", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "ceil" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "trunc", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "trunc" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "abs", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "abs" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "sqrt", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "sqrt" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "pow", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "powf" }, result: { ref: "float64" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "Math", member: "round", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_round" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "max", operationKind: "call", lane: "math", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_abi::math_max", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "float64" } } },
  { owner: "Math", member: "min", operationKind: "call", lane: "math", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_abi::math_min", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "float64" } } },
  { owner: "Math", member: "random", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_random" }, result: { ref: "float64" } } },

  ...numberPredicateRows.flatMap(({ member, path }) => [
    { owner: "NumberConstructor", member, operationKind: "call" as const, lane: "number" as const, variant: "float64", shape: { op: "operation" as const, operationKind: "method" as const, target: { form: "call" as const, path }, result: { ref: "bool" as const }, params: [{ ref: "float64" as const }] } },
    { owner: "NumberConstructor", member, operationKind: "call" as const, lane: "number" as const, variant: "int32", shape: { op: "operation" as const, operationKind: "method" as const, target: { form: "call" as const, path, argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "bool" as const }, params: [{ ref: "int32" as const }] } },
  ]),

  // Date lane.
  { owner: "DateConstructor", member: "parse", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::parse", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "DateConstructor", member: "UTC", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::utc" }, result: { ref: "float64" }, params: [{ ref: "float64" }, { ref: "float64" }, { ref: "float64" }, { ref: "float64" }, { ref: "float64" }, { ref: "float64" }, { ref: "float64" }] } },
  { owner: "Date", member: "toJSON", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_json" }, result: { ref: "string" } } },
  { owner: "Date", member: "valueOf", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_time" }, result: { ref: "float64" } } },
  { owner: "DateConstructor", member: "now", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::now" }, result: { ref: "float64" } } },
  { owner: "Date", member: "toISOString", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_iso_string" }, result: { ref: "string" } } },
  { owner: "Date", member: "getTime", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_time" }, result: { ref: "float64" } } },
];

interface JsLaneBindings {
  readonly element?: TargetTypeRef;
  readonly mapKey?: TargetTypeRef;
  readonly mapValue?: TargetTypeRef;
  readonly setValue?: TargetTypeRef;
  readonly receiver?: TargetTypeRef;
  readonly selectedMethodTypeArguments?: readonly (TargetTypeRef | undefined)[];
}

function laneOf(carrier: TargetTypeRef | undefined, ownerName: string): { readonly lane: JsLane; readonly bindings: JsLaneBindings } | undefined {
  if (carrier?.kind === "pointer" && carrier.pointee.kind === "target-named" && carrier.pointee.id === rustStringTargetId) {
    // Borrowed string parameters (&str) share the string lane.
    return { lane: "string", bindings: { receiver: carrier.pointee } };
  }
  if (carrier?.kind === "target-named") {
    if (isRustJsArrayCarrier(carrier)) {
      const element = carrier.typeArguments?.[0];
      return element === undefined ? undefined : { lane: "js-array", bindings: { element, receiver: carrier } };
    }
    if (carrier.id === rustJsMapTargetId) {
      const [mapKey, mapValue] = carrier.typeArguments ?? [];
      return mapKey === undefined || mapValue === undefined
        ? undefined
        : { lane: "map", bindings: { mapKey, mapValue, receiver: carrier } };
    }
    if (carrier.id === rustJsSetTargetId) {
      const setValue = carrier.typeArguments?.[0];
      return setValue === undefined ? undefined : { lane: "set", bindings: { setValue, receiver: carrier } };
    }
    if (carrier.id === rustJsDateTargetId) {
      return { lane: "date", bindings: { receiver: carrier } };
    }
  }
  if (isRustStringCarrier(carrier)) {
    return { lane: "string", bindings: { receiver: carrier } };
  }
  // Static owners have no receiver carrier; the lane comes from the owner row.
  if (carrier === undefined && ownerName === "DateConstructor") {
    return { lane: "date", bindings: {} };
  }
  if (carrier === undefined && ownerName === "JSON") {
    return { lane: "json", bindings: {} };
  }
  if (carrier === undefined && ownerName === "Math") {
    return { lane: "math", bindings: {} };
  }
  if (carrier === undefined && ownerName === "NumberConstructor") {
    return { lane: "number", bindings: {} };
  }
  if (carrier === undefined && ownerName === "Console") {
    return { lane: "console", bindings: {} };
  }
  if (carrier?.kind === "target-named" && carrier.id === "rust.js.JsRegExp") {
    return { lane: "regexp", bindings: { receiver: carrier } };
  }
  if (carrier?.kind === "target-named" && carrier.id === "rust.js.JsRegExpMatch") {
    return { lane: "regexp-match", bindings: { receiver: carrier } };
  }
  return undefined;
}

export const rustInferCarrier: TargetTypeRef = { kind: "opaque", id: "tsonic.rust.infer" };

function resolveCarrierRef(reference: JsCarrierRef, bindings: JsLaneBindings): TargetTypeRef | undefined {
  switch (reference.ref) {
    case "cb-predicate":
      return bindings.element === undefined
        ? undefined
        : { kind: "function-pointer", args: [bindings.element], result: rustSourcePrimitiveTargetType("bool") };
    case "cb-map":
      return bindings.element === undefined
        ? undefined
        : { kind: "function-pointer", args: [bindings.element], result: rustInferCarrier };
    case "cb-reduce":
      return bindings.element === undefined
        ? undefined
        : { kind: "function-pointer", args: [rustInferCarrier, bindings.element], result: rustInferCarrier };
    case "int32":
      return rustSourcePrimitiveTargetType("int32");
    case "jsvalue":
      return rustJsValueTargetType();
    case "string-array":
      return rustJsArrayTargetType(rustStringTargetType());
    case "regexp-match":
      return { kind: "target-named", id: "rust.js.JsRegExpMatch" };
    case "option-of-regexp-match":
      return rustOptionTargetType({ kind: "target-named", id: "rust.js.JsRegExpMatch" });
    case "regexp-match-vec":
      return rustVecTargetType({ kind: "target-named", id: "rust.js.JsRegExpMatch" });
    case "option-of-string":
      return rustOptionTargetType(rustStringTargetType());
    case "option-of-string-array":
      return rustOptionTargetType(rustJsArrayTargetType(rustStringTargetType()));
    case "element-array":
      return bindings.element === undefined ? undefined : rustJsArrayTargetType(bindings.element);
    case "option-of-float64":
      return rustOptionTargetType(rustSourcePrimitiveTargetType("float64"));
    case "float64":
      return rustSourcePrimitiveTargetType("float64");
    case "infer":
      return rustInferCarrier;
    case "selected-method-type-argument":
      return bindings.selectedMethodTypeArguments?.[reference.index];
    case "bool":
      return rustSourcePrimitiveTargetType("bool");
    case "unit":
      return rustUnitTargetType();
    case "string":
      return rustStringTargetType();
    case "element":
      return bindings.element;
    case "option-of-element":
      return bindings.element === undefined ? undefined : rustOptionTargetType(bindings.element);
    case "receiver":
      return bindings.receiver;
    case "map-key":
      return bindings.mapKey;
    case "map-value":
      return bindings.mapValue;
    case "option-of-map-value":
      return bindings.mapValue === undefined ? undefined : rustOptionTargetType(bindings.mapValue);
    case "set-value":
      return bindings.setValue;
  }
}

export function finalizeJsCallbackOperation(
  selection: JsOperationSelection,
  argumentCarriers: readonly TargetTypeRef[],
): JsOperationSelection | undefined {
  if (selection.fact.kind !== "provider-operation" || selection.callbackShape === undefined) {
    return undefined;
  }
  const callback = argumentCarriers[0];
  const callbackTemplate = selection.parameterCarriers?.[0];
  if (callback?.kind !== "function-pointer" || callbackTemplate?.kind !== "function-pointer" ||
    !rustCallbackCarrierMatchesTemplate(callbackTemplate, callback)) {
    return undefined;
  }
  if (selection.callbackShape === "map") {
    const resultCarrier = rustJsArrayTargetType(callback.result);
    const parameterCarriers = [callback, ...(selection.parameterCarriers?.slice(1) ?? [])];
    return {
      fact: {
        ...selection.fact,
        resultCarrier,
        parameterCarriers,
      },
      resultCarrier,
      parameterCarriers,
    };
  }
  const accumulator = argumentCarriers[1];
  if (accumulator === undefined || callback.args.length < 1 ||
    !rustTargetTypeRefEquals(callback.args[0]!, accumulator) ||
    !rustTargetTypeRefEquals(callback.result, accumulator)) {
    return undefined;
  }
  const parameterCarriers = [callback, accumulator];
  return {
    fact: {
      ...selection.fact,
      resultCarrier: accumulator,
      parameterCarriers,
    },
    resultCarrier: accumulator,
    parameterCarriers,
  };
}

function rustCallbackCarrierMatchesTemplate(
  template: TargetTypeRef,
  actual: TargetTypeRef,
): boolean {
  if (template.kind === "opaque" && template.id === "tsonic.rust.infer") {
    return true;
  }
  if (template.kind !== actual.kind) {
    return false;
  }
  if (template.kind !== "function-pointer" || actual.kind !== "function-pointer") {
    return rustTargetTypeRefEquals(template, actual);
  }
  return template.args.length === actual.args.length &&
    template.args.every((argument, index) =>
      actual.args[index] !== undefined &&
      rustCallbackCarrierMatchesTemplate(argument, actual.args[index]!)) &&
    rustCallbackCarrierMatchesTemplate(template.result, actual.result);
}

function copyStyleOf(carrier: TargetTypeRef | undefined): { readonly kind: "method"; readonly name: "copied" | "cloned" } {
  return {
    kind: "method",
    name: carrier !== undefined && (carrier.kind === "source-primitive" || isRustNumericCarrier(carrier))
      ? "copied"
      : "cloned",
  };
}

function materializeTarget(
  target: RustProviderOperationForm,
  copyCarrier: TargetTypeRef | undefined,
): RustProviderOperationForm {
  if (target.form !== "receiver-method" || target.chain === undefined) {
    return target;
  }
  return {
    ...target,
    chain: target.chain.map((entry) => entry.kind === "copy-selected-carrier" ? copyStyleOf(copyCarrier) : entry),
  };
}

function firstArgumentId(request: JsOperationRequest): string | undefined {
  const carrier = request.argumentCarriers?.[0];
  return carrier?.kind === "target-named" ? carrier.id : undefined;
}

export function selectJsSurfaceOperation(request: JsOperationRequest): JsOperationSelection | undefined {
  const laneMatch = laneOf(request.receiverCarrier, request.ownerName);
  if (laneMatch === undefined) {
    return undefined;
  }
  const { lane } = laneMatch;
  const bindings: JsLaneBindings = {
    ...laneMatch.bindings,
    selectedMethodTypeArguments: request.selectedMethodTypeArgumentCarriers,
  };
  const argumentCarriers = request.argumentCarriers ?? [];
  const matches = jsOperationRows.flatMap((candidate) => {
    if (!(
      candidate.owner === request.ownerName &&
      candidate.member === request.memberName &&
      candidate.operationKind === request.operationKind &&
      candidate.lane === lane &&
      (candidate.selectedMethodTypeArgumentArity === undefined ||
        candidate.selectedMethodTypeArgumentArity ===
          (request.selectedMethodTypeArgumentCarriers?.length ?? 0)) &&
      elementGuardMatches(candidate.elementGuard, bindings.element) &&
      (candidate.firstArgCarrierId === undefined
        ? firstArgumentId(request) === undefined || !jsOperationRows.some((other) =>
            other.owner === candidate.owner && other.member === candidate.member &&
            other.operationKind === candidate.operationKind && other.firstArgCarrierId === firstArgumentId(request))
        : candidate.firstArgCarrierId === firstArgumentId(request))
    )) {
      return [];
    }
    const parameterCarriers = (candidate.shape.params ?? []).map((reference) =>
      reference === undefined ? undefined : resolveCarrierRef(reference, bindings));
    if (candidate.variadic !== true && parameterCarriers.length !== argumentCarriers.length) {
      return [];
    }
    const argumentScores = candidate.variadic === true
      ? []
      : parameterCarriers.map((carrier, index) =>
          jsArgumentCarrierMatchScore(
            carrier,
            argumentCarriers[index],
            index,
            request.argumentCompatibility,
          ));
    if (argumentScores.some((score) => score === undefined)) {
      return [];
    }
    return [{
      row: candidate,
      parameterCarriers,
      score: (argumentScores as number[]).reduce((total, score) => total + score, 0),
    }];
  });
  const minimumScore = matches.reduce(
    (minimum, candidate) => Math.min(minimum, candidate.score),
    Number.POSITIVE_INFINITY,
  );
  const bestMatches = matches.filter((candidate) => candidate.score === minimumScore);
  if (bestMatches.length !== 1) {
    return undefined;
  }
  const selected = bestMatches[0];
  if (selected === undefined) {
    return undefined;
  }
  const { row, parameterCarriers } = selected;
  const selectedParameterCarriers = row.variadic === true ? undefined : parameterCarriers;
  const operationId = `tsonic.rust.js.${row.owner}.${row.member}.${row.operationKind}${row.variant === undefined ? "" : `.${row.variant}`}`;
  if (row.shape.op === "set") {
    if (parameterCarriers.some((carrier) => carrier === undefined)) {
      return undefined;
    }
    return {
      fact: {
        kind: "runtime-set",
        operationId,
        target: row.shape.target,
        parameterCarriers: parameterCarriers as readonly TargetTypeRef[],
      },
      ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
    };
  }
  const resultCarrier = resolveCarrierRef(row.shape.result, bindings);
  if (resultCarrier === undefined) {
    return undefined;
  }
  const copyReference = row.shape.result.ref === "option-of-map-value" ? bindings.mapValue : bindings.element;
  return {
    fact: {
      kind: "provider-operation",
      operationId,
      operationKind: row.shape.operationKind,
      target: materializeTarget(row.shape.target, copyReference),
      resultCarrier,
      ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
      isAsync: false,
      isFallible: row.fallible === true,
      ...(row.shape.resultConversion === undefined ? {} : { resultConversion: row.shape.resultConversion }),
    },
    resultCarrier,
    ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
    ...(row.callback === undefined ? {} : { callbackShape: row.callback }),
  };
}

function elementGuardMatches(
  guard: JsOperationRowData["elementGuard"],
  carrier: TargetTypeRef | undefined,
): boolean {
  if (guard === undefined) {
    return true;
  }
  if (guard === "numeric") {
    return isRustNumericCarrier(carrier);
  }
  if (guard === "stringifiable") {
    return isRustIntegerCarrier(carrier) || isRustBoolCarrier(carrier) ||
      isRustStringCarrier(carrier);
  }
  return rustConcreteCarrierIsClone(carrier);
}

function rustConcreteCarrierIsClone(carrier: TargetTypeRef | undefined): boolean {
  if (carrier === undefined || carrier.kind === "type-parameter" ||
    carrier.kind === "function-pointer" || carrier.kind === "associated-type" ||
    carrier.kind === "pointer") {
    return false;
  }
  if (carrier.kind === "source-primitive" || isRustStringCarrier(carrier) ||
    isRustJsValueCarrier(carrier) || rustSourceTypeCarrierValue(carrier) !== undefined) {
    return true;
  }
  if (carrier.kind === "array") {
    return rustConcreteCarrierIsClone(carrier.element);
  }
  if (carrier.kind === "tuple") {
    return carrier.elements.every(rustConcreteCarrierIsClone);
  }
  if (carrier.kind === "target-named") {
    return (carrier.typeArguments ?? []).every(rustConcreteCarrierIsClone);
  }
  return false;
}

function jsArgumentCarrierMatchScore(
  expected: TargetTypeRef | undefined,
  actual: TargetTypeRef | undefined,
  index: number,
  compatibility: JsOperationRequest["argumentCompatibility"],
): number | undefined {
  if (actual === undefined) {
    return expected === undefined
      ? undefined
      : compatibility?.(expected, actual, index);
  }
  if (expected === undefined || (expected.kind === "opaque" && expected.id === "tsonic.rust.infer")) {
    return 0;
  }
  if (expected.kind === "function-pointer" && actual.kind === "function-pointer") {
    if (expected.args.length !== actual.args.length) {
      return compatibility?.(expected, actual, index);
    }
    const scores = [
      ...expected.args.map((argument, argumentIndex) =>
        jsArgumentCarrierMatchScore(argument, actual.args[argumentIndex], index, compatibility)),
      jsArgumentCarrierMatchScore(expected.result, actual.result, index, compatibility),
    ];
    return scores.some((score) => score === undefined)
      ? compatibility?.(expected, actual, index)
      : (scores as number[]).reduce((total, score) => total + score, 0);
  }
  if (rustTargetTypeRefEquals(expected, actual)) {
    return 0;
  }
  return compatibility?.(expected, actual, index);
}

// Constructor rows: matched by lib class declaration identity plus argument
// and type-argument shape guards.
interface JsConstructorRowData {
  readonly className: string;
  readonly sourceOwnerName: string;
  readonly typeArgumentCount: number;
  readonly argumentCount: number;
  readonly path: string;
  readonly result: "map" | "set" | "date";
  readonly params?: readonly (JsCarrierRef | undefined)[];
}

const jsConstructorRows: readonly JsConstructorRowData[] = [
  { className: "Map", sourceOwnerName: "MapConstructor", typeArgumentCount: 2, argumentCount: 0, path: "js_abi::JsMap::new", result: "map" },
  { className: "Set", sourceOwnerName: "SetConstructor", typeArgumentCount: 1, argumentCount: 0, path: "js_abi::JsSet::new", result: "set" },
  { className: "Date", sourceOwnerName: "DateConstructor", typeArgumentCount: 0, argumentCount: 1, path: "js_abi::JsDate::from_millis", result: "date", params: [{ ref: "float64" }] },
];

export interface JsConstructorRequest {
  readonly className: string;
  readonly typeArgumentCarriers: readonly (TargetTypeRef | undefined)[];
  readonly argumentCarriers: readonly (TargetTypeRef | undefined)[];
}

export function selectJsSurfaceConstructor(request: JsConstructorRequest): JsOperationSelection | undefined {
  const row = jsConstructorRows.find((candidate) =>
    candidate.className === request.className &&
    candidate.typeArgumentCount === request.typeArgumentCarriers.length &&
    candidate.argumentCount === request.argumentCarriers.length);
  if (row === undefined) {
    return undefined;
  }
  const typeArguments = request.typeArgumentCarriers;
  if (!typeArguments.every((carrier) => carrier === undefined || isPrimitiveLaneCarrier(carrier))) {
    return undefined;
  }
  let resultCarrier: TargetTypeRef | undefined;
  if (row.result === "map") {
    const [key, value] = typeArguments;
    resultCarrier = key !== undefined && value !== undefined ? rustJsMapTargetType(key, value) : undefined;
  } else if (row.result === "set") {
    const [value] = typeArguments;
    resultCarrier = value !== undefined ? rustJsSetTargetType(value) : undefined;
  } else {
    resultCarrier = rustJsDateTargetType();
  }
  if (resultCarrier === undefined) {
    return undefined;
  }
  const parameterCarriers = (row.params ?? []).map((reference) =>
    reference === undefined ? undefined : resolveCarrierRef(reference, {}));
  return {
    fact: {
      kind: "provider-operation",
      operationId: `tsonic.rust.js.${row.className}.constructor`,
      operationKind: "constructor",
      target: { form: "call", path: row.path },
      resultCarrier,
      parameterCarriers,
      isAsync: false,
      isFallible: false,
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

function isPrimitiveLaneCarrier(carrier: TargetTypeRef): boolean {
  return carrier.kind === "source-primitive" || isRustStringCarrier(carrier);
}

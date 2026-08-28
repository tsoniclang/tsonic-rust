import type { JsOperationRowData } from "./model.js";
import {
  rustJsValueTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
} from "../../../target-model/types/index.js";

const falseArgument = { kind: "boolean", value: false } as const;

const symbolRows: readonly JsOperationRowData[] = [
  { owner: "SymbolConstructor", member: "call", operationKind: "call", lane: "symbol", variant: "empty", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsSymbol::create" }, result: { ref: "symbol" } } },
  { owner: "SymbolConstructor", member: "call", operationKind: "call", lane: "symbol", variant: "string", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsSymbol::create_string", argModes: ["ref"] }, result: { ref: "symbol" }, params: [{ ref: "string" }] } },
  { owner: "SymbolConstructor", member: "call", operationKind: "call", lane: "symbol", variant: "number", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsSymbol::create_number" }, result: { ref: "symbol" }, params: [{ ref: "float64" }] } },
  { owner: "SymbolConstructor", member: "for", operationKind: "call", lane: "symbol", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsSymbol::for_key", argModes: ["ref"] }, result: { ref: "symbol" }, params: [{ ref: "string" }] } },
  { owner: "SymbolConstructor", member: "keyFor", operationKind: "call", lane: "symbol", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsSymbol::key_for", argModes: ["ref"] }, result: { ref: "option-of-string" }, sourceResult: { ref: "string" }, sourceAbsence: "undefined", params: [{ ref: "symbol" }] } },
];

const weakCollectionRows: readonly JsOperationRowData[] = [
  { owner: "WeakMap", member: "get", operationKind: "call", lane: "weak-map", requirements: [{ carrier: { ref: "weak-value" }, capability: "clone" }, { carrier: { ref: "weak-key" }, capability: "object-identity" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get", argModes: ["ref"] }, result: { ref: "option-of-weak-value" }, sourceResult: { ref: "weak-value" }, sourceAbsence: "undefined", params: [{ ref: "weak-key" }] } },
  { owner: "WeakMap", member: "has", operationKind: "call", lane: "weak-map", requirements: [{ carrier: { ref: "weak-key" }, capability: "object-identity" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "weak-key" }] } },
  { owner: "WeakMap", member: "delete", operationKind: "call", lane: "weak-map", requirements: [{ carrier: { ref: "weak-key" }, capability: "object-identity" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "weak-key" }] } },
  { owner: "WeakMap", member: "set", operationKind: "call", lane: "weak-map", requirements: [{ carrier: { ref: "weak-key" }, capability: "object-identity" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "set" }, result: { ref: "receiver" }, params: [{ ref: "weak-key" }, { ref: "weak-value" }] } },
  { owner: "WeakSet", member: "has", operationKind: "call", lane: "weak-set", requirements: [{ carrier: { ref: "weak-key" }, capability: "object-identity" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "weak-key" }] } },
  { owner: "WeakSet", member: "delete", operationKind: "call", lane: "weak-set", requirements: [{ carrier: { ref: "weak-key" }, capability: "object-identity" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "weak-key" }] } },
  { owner: "WeakSet", member: "add", operationKind: "call", lane: "weak-set", requirements: [{ carrier: { ref: "weak-key" }, capability: "object-identity" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "add" }, result: { ref: "receiver" }, params: [{ ref: "weak-key" }] } },
];

const arrayBufferRows: readonly JsOperationRowData[] = [
  { owner: "ArrayBuffer", member: "byteLength", operationKind: "property", lane: "array-buffer", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "byte_length" }, result: { ref: "float64" }, evaluation: "pure" } },
  { owner: "ArrayBuffer", member: "slice", operationKind: "call", lane: "array-buffer", variant: "all", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_all" }, result: { ref: "array-buffer" } } },
  { owner: "ArrayBuffer", member: "slice", operationKind: "call", lane: "array-buffer", variant: "start", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_from" }, result: { ref: "array-buffer" }, params: [{ ref: "float64" }] } },
  { owner: "ArrayBuffer", member: "slice", operationKind: "call", lane: "array-buffer", variant: "start-end", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_to" }, result: { ref: "array-buffer" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
];

const dataViewRows: readonly JsOperationRowData[] = [
  { owner: "DataView", member: "buffer", operationKind: "property", lane: "data-view", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "buffer" }, result: { ref: "array-buffer" }, evaluation: "pure" } },
  { owner: "DataView", member: "byteLength", operationKind: "property", lane: "data-view", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "byte_length" }, result: { ref: "float64" }, evaluation: "pure" } },
  { owner: "DataView", member: "byteOffset", operationKind: "property", lane: "data-view", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "byte_offset" }, result: { ref: "float64" }, evaluation: "pure" } },
  ...["Int8", "Uint8"].map((suffix): JsOperationRowData => ({ owner: "DataView", member: `get${suffix}`, operationKind: "call", lane: "data-view", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `get_${suffix.toLowerCase()}` }, result: { ref: "float64" }, params: [{ ref: "float64" }] } })),
  ...["Int16", "Uint16", "Int32", "Uint32", "Float32", "Float64"].flatMap((suffix): readonly JsOperationRowData[] => {
    const name = suffix.replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase();
    return [
      { owner: "DataView", member: `get${suffix}`, operationKind: "call", lane: "data-view", variant: "default-endian", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `get_${name}`, trailingArguments: [falseArgument] }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
      { owner: "DataView", member: `get${suffix}`, operationKind: "call", lane: "data-view", variant: "endian", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `get_${name}` }, result: { ref: "float64" }, params: [{ ref: "float64" }, { ref: "bool" }] } },
    ];
  }),
  ...["Int8", "Uint8"].map((suffix): JsOperationRowData => ({ owner: "DataView", member: `set${suffix}`, operationKind: "call", lane: "data-view", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `set_${suffix.toLowerCase()}` }, result: { ref: "unit" }, params: [{ ref: "float64" }, { ref: "float64" }] } })),
  ...["Int16", "Uint16", "Int32", "Uint32", "Float32", "Float64"].flatMap((suffix): readonly JsOperationRowData[] => {
    const name = suffix.replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase();
    return [
      { owner: "DataView", member: `set${suffix}`, operationKind: "call", lane: "data-view", variant: "default-endian", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `set_${name}`, trailingArguments: [falseArgument] }, result: { ref: "unit" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
      { owner: "DataView", member: `set${suffix}`, operationKind: "call", lane: "data-view", variant: "endian", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `set_${name}` }, result: { ref: "unit" }, params: [{ ref: "float64" }, { ref: "float64" }, { ref: "bool" }] } },
    ];
  }),
];

const typedArrayRows: readonly JsOperationRowData[] = [
  ...[
    ["buffer", "buffer", { ref: "array-buffer" }],
    ["byteLength", "byte_length", { ref: "float64" }],
    ["byteOffset", "byte_offset", { ref: "float64" }],
    ["length", "length", { ref: "float64" }],
    ["BYTES_PER_ELEMENT", "bytes_per_element", { ref: "float64" }],
  ].map(([member, name, result]): JsOperationRowData => ({ owner: "TypedArray", member: member as string, operationKind: "property", lane: "typed-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: name as string }, result: result as { readonly ref: "array-buffer" | "float64" }, evaluation: "pure" } })),
  { owner: "TypedArray", member: "index", operationKind: "indexer", lane: "typed-array", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get_number" }, result: { ref: "option-of-float64" }, sourceResult: { ref: "float64" }, sourceAbsence: "undefined", params: [{ ref: "float64" }] } },
  { owner: "TypedArray", member: "index", operationKind: "index-set", lane: "typed-array", shape: { op: "set", target: { form: "receiver-method", name: "set_number" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "TypedArray", member: "at", operationKind: "call", lane: "typed-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "at" }, result: { ref: "option-of-float64" }, sourceResult: { ref: "float64" }, sourceAbsence: "undefined", params: [{ ref: "float64" }] } },
  ...[1, 2, 3].map((arity): JsOperationRowData => ({ owner: "TypedArray", member: "fill", operationKind: "call", lane: "typed-array", variant: String(arity), shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: ["fill_all", "fill_from", "fill_to"][arity - 1]! }, result: { ref: "receiver" }, params: Array.from({ length: arity }, () => ({ ref: "float64" as const })) } })),
  { owner: "TypedArray", member: "includes", operationKind: "call", lane: "typed-array", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes_from_start" }, result: { ref: "bool" }, params: [{ ref: "float64" }] } },
  { owner: "TypedArray", member: "includes", operationKind: "call", lane: "typed-array", variant: "from", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes" }, result: { ref: "bool" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "TypedArray", member: "indexOf", operationKind: "call", lane: "typed-array", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of_from_start" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "TypedArray", member: "indexOf", operationKind: "call", lane: "typed-array", variant: "from", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of" }, result: { ref: "float64" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "TypedArray", member: "join", operationKind: "call", lane: "typed-array", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "join_default" }, result: { ref: "string" } } },
  { owner: "TypedArray", member: "join", operationKind: "call", lane: "typed-array", variant: "separator", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "join", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
  { owner: "TypedArray", member: "reverse", operationKind: "call", lane: "typed-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "reverse" }, result: { ref: "receiver" } } },
  { owner: "TypedArray", member: "set", operationKind: "call", lane: "typed-array", variant: "default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "set_from_array_default", argModes: ["ref"] }, result: { ref: "unit" }, params: [{ ref: "float64-array" }] } },
  { owner: "TypedArray", member: "set", operationKind: "call", lane: "typed-array", variant: "offset", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "set_from_array", argModes: ["ref", "value"] }, result: { ref: "unit" }, params: [{ ref: "float64-array" }, { ref: "float64" }] } },
  ...["slice", "subarray"].flatMap((member): readonly JsOperationRowData[] => [
    { owner: "TypedArray", member, operationKind: "call", lane: "typed-array", variant: "all", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `${member}_all` }, result: { ref: "receiver" } } },
    { owner: "TypedArray", member, operationKind: "call", lane: "typed-array", variant: "start", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `${member}_from` }, result: { ref: "receiver" }, params: [{ ref: "float64" }] } },
    { owner: "TypedArray", member, operationKind: "call", lane: "typed-array", variant: "start-end", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: `${member}_to` }, result: { ref: "receiver" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  ]),
  { owner: "TypedArray", member: "sort", operationKind: "call", lane: "typed-array", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "sort_default" }, result: { ref: "receiver" } } },
  { owner: "TypedArray", member: "sort", operationKind: "call", lane: "typed-array", variant: "compare", callback: { shape: "direct", sourceArgumentIndex: 0, fallibleTarget: { form: "receiver-method", name: "try_sort_by" } }, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "sort_by" }, result: { ref: "receiver" }, params: [{ ref: "cb-array-comparator", arity: 2 }] } },
];

const intlRows: readonly JsOperationRowData[] = [
  { owner: "IntlDateTimeFormat", member: "format", operationKind: "call", lane: "intl-date-time", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "format_default" }, result: { ref: "string" } } },
  { owner: "IntlDateTimeFormat", member: "format", operationKind: "call", lane: "intl-date-time", variant: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "format_date", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "date" }] } },
  { owner: "IntlDateTimeFormat", member: "format", operationKind: "call", lane: "intl-date-time", variant: "number", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "format_number" }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "IntlDateTimeFormat", member: "formatToParts", operationKind: "call", lane: "intl-date-time", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "format_to_parts_default" }, result: { ref: "source-result" } } },
  { owner: "IntlDateTimeFormat", member: "formatToParts", operationKind: "call", lane: "intl-date-time", variant: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "format_to_parts_date", argModes: ["ref"] }, result: { ref: "source-result" }, params: [{ ref: "date" }] } },
  { owner: "IntlDateTimeFormat", member: "formatToParts", operationKind: "call", lane: "intl-date-time", variant: "number", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "format_to_parts_number" }, result: { ref: "source-result" }, params: [{ ref: "float64" }] } },
  { owner: "IntlDateTimeFormat", member: "resolvedOptions", operationKind: "call", lane: "intl-date-time", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "resolved_options" }, result: { ref: "source-result" } } },
  { owner: "IntlNumberFormat", member: "format", operationKind: "call", lane: "intl-number", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "format" }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "IntlNumberFormat", member: "formatToParts", operationKind: "call", lane: "intl-number", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "format_to_parts" }, result: { ref: "source-result" }, params: [{ ref: "float64" }] } },
  { owner: "IntlNumberFormat", member: "resolvedOptions", operationKind: "call", lane: "intl-number", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "resolved_options" }, result: { ref: "source-result" } } },
  { owner: "IntlCollator", member: "compare", operationKind: "call", lane: "intl-collator", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "compare", argModes: ["ref", "ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "string" }] } },
  { owner: "IntlCollator", member: "resolvedOptions", operationKind: "call", lane: "intl-collator", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "resolved_options" }, result: { ref: "source-result" } } },
  ...[
    ["IntlDateTimeFormatPart", "type", "type_value", "string"],
    ["IntlDateTimeFormatPart", "value", "value", "string"],
    ["IntlNumberFormatPart", "type", "type_value", "string"],
    ["IntlNumberFormatPart", "value", "value", "string"],
    ["IntlResolvedDateTimeFormatOptions", "locale", "locale", "string"],
    ["IntlResolvedDateTimeFormatOptions", "calendar", "calendar", "string"],
    ["IntlResolvedDateTimeFormatOptions", "numberingSystem", "numbering_system", "string"],
    ["IntlResolvedDateTimeFormatOptions", "timeZone", "time_zone", "string"],
    ["IntlResolvedNumberFormatOptions", "locale", "locale", "string"],
    ["IntlResolvedNumberFormatOptions", "numberingSystem", "numbering_system", "string"],
    ["IntlResolvedNumberFormatOptions", "style", "style", "string"],
    ["IntlResolvedNumberFormatOptions", "minimumIntegerDigits", "minimum_integer_digits", "float64"],
    ["IntlResolvedNumberFormatOptions", "minimumFractionDigits", "minimum_fraction_digits", "float64"],
    ["IntlResolvedNumberFormatOptions", "maximumFractionDigits", "maximum_fraction_digits", "float64"],
    ["IntlResolvedNumberFormatOptions", "useGrouping", "use_grouping", "bool"],
    ["IntlResolvedCollatorOptions", "locale", "locale", "string"],
    ["IntlResolvedCollatorOptions", "usage", "usage", "string"],
    ["IntlResolvedCollatorOptions", "sensitivity", "sensitivity", "string"],
    ["IntlResolvedCollatorOptions", "ignorePunctuation", "ignore_punctuation", "bool"],
    ["IntlResolvedCollatorOptions", "collation", "collation", "string"],
    ["IntlResolvedCollatorOptions", "numeric", "numeric", "bool"],
    ["IntlResolvedCollatorOptions", "caseFirst", "case_first", "string"],
  ].map(([owner, member, name, result]): JsOperationRowData => ({ owner: owner!, member: member!, operationKind: "property", lane: "intl-record", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: name! }, result: { ref: result as "string" | "float64" | "bool" }, evaluation: "pure" } })),
];

const consoleVariadicRows = [
  ["dirxml", "js_abi::console_dirxml"],
  ["group", "js_abi::console_group"],
  ["groupCollapsed", "js_abi::console_group_collapsed"],
  ["trace", "js_abi::console_trace"],
] as const;

const consoleRows: readonly JsOperationRowData[] = [
  { owner: "Console", member: "assert", operationKind: "call", lane: "console", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::console_assert_default" }, result: { ref: "unit" } } },
  { owner: "Console", member: "assert", operationKind: "call", lane: "console", variant: "condition", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_abi::console_assert", leadingArguments: [{ carrier: rustSourcePrimitiveTargetType("bool"), mode: "value" }], elementCarrier: rustJsValueTargetType() }, result: { ref: "unit" }, params: [{ ref: "bool" }] } },
  { owner: "Console", member: "clear", operationKind: "call", lane: "console", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::console_clear" }, result: { ref: "unit" } } },
  ...(["count", "countReset", "time", "timeEnd", "timeStamp"] as const).flatMap((member): readonly JsOperationRowData[] => {
    const target = member.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
    return [
      { owner: "Console", member, operationKind: "call", lane: "console", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "call", path: `js_abi::console_${target}` }, result: { ref: "unit" } } },
      { owner: "Console", member, operationKind: "call", lane: "console", variant: "label", shape: { op: "operation", operationKind: "method", target: { form: "call", path: `js_abi::console_${target}_label`, argModes: ["ref"] }, result: { ref: "unit" }, params: [{ ref: "string" }] } },
    ];
  }),
  { owner: "Console", member: "dir", operationKind: "call", lane: "console", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::console_dir", argModes: ["ref"] }, result: { ref: "unit" }, params: [{ ref: "jsvalue" }] } },
  { owner: "Console", member: "dir", operationKind: "call", lane: "console", variant: "options", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::console_dir_with_options", argModes: ["ref", "ref"] }, result: { ref: "unit" }, params: [{ ref: "jsvalue" }, { ref: "jsvalue" }] } },
  { owner: "Console", member: "groupEnd", operationKind: "call", lane: "console", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::console_group_end" }, result: { ref: "unit" } } },
  { owner: "Console", member: "timeLog", operationKind: "call", lane: "console", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_abi::console_time_log", leadingArguments: [], elementCarrier: rustJsValueTargetType() }, result: { ref: "unit" } } },
  { owner: "Console", member: "timeLog", operationKind: "call", lane: "console", variant: "label", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_abi::console_time_log_label", leadingArguments: [{ carrier: rustStringTargetType(), mode: "ref" }], elementCarrier: rustJsValueTargetType() }, result: { ref: "unit" }, params: [{ ref: "string" }] } },
  ...consoleVariadicRows.map(([member, path]): JsOperationRowData => ({ owner: "Console", member, operationKind: "call", lane: "console", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path, leadingArguments: [], elementCarrier: rustJsValueTargetType() }, result: { ref: "unit" } } })),
];

const timerRows: readonly JsOperationRowData[] = [
  ...(["setTimeout", "setInterval"] as const).flatMap((member): readonly JsOperationRowData[] => {
    const path = member === "setTimeout"
      ? "js_abi::set_timeout_callable"
      : "js_abi::set_interval_callable";
    return [
      { owner: "Global", member, operationKind: "call", lane: "global", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "call", path, trailingArguments: [{ kind: "float64", value: 0 }] }, result: { ref: "float64" }, params: [{ ref: "argument", index: 0 }] } },
      { owner: "Global", member, operationKind: "call", lane: "global", variant: "delay", shape: { op: "operation", operationKind: "method", target: { form: "call", path }, result: { ref: "float64" }, params: [{ ref: "argument", index: 0 }, { ref: "float64" }] } },
    ];
  }),
  { owner: "Global", member: "clearTimeout", operationKind: "call", lane: "global", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::clear_timeout" }, result: { ref: "unit" }, params: [{ ref: "float64" }] } },
  { owner: "Global", member: "clearInterval", operationKind: "call", lane: "global", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::clear_interval" }, result: { ref: "unit" }, params: [{ ref: "float64" }] } },
];

const promiseRows: readonly JsOperationRowData[] = [
  ...(["race", "any"] as const).map((member): JsOperationRowData => ({
    owner: "PromiseConstructor",
    member,
    operationKind: "call",
    lane: "promise",
    requirements: [{ carrier: { ref: "future-output" }, capability: "clone" }],
    returnedFuture: { awaiting: "fallible", errorBoundary: "source-program" },
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "call",
        path: member === "race" ? "js_abi::promise_race" : "js_abi::promise_any",
        argModes: ["ref"],
      },
      result: { ref: "source-result" },
      params: [{ ref: "argument", index: 0 }],
    },
  })),
  {
    owner: "PromiseConstructor",
    member: "allSettled",
    operationKind: "call",
    lane: "promise",
    requirements: [{ carrier: { ref: "promise-input-output" }, capability: "clone" }],
    returnedFuture: { awaiting: "infallible", errorBoundary: "none" },
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "call", path: "js_abi::promise_all_settled", argModes: ["ref"] },
      result: { ref: "source-result" },
      params: [{ ref: "argument", index: 0 }],
    },
  },
  {
    owner: "Promise",
    member: "finally",
    operationKind: "call",
    lane: "promise",
    variant: "default",
    requirements: [{ carrier: { ref: "promise-output" }, capability: "clone" }],
    returnedFuture: { awaiting: "fallible", errorBoundary: "source-program" },
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "receiver-method", name: "finally_default" },
      result: { ref: "source-result" },
    },
  },
  {
    owner: "Promise",
    member: "finally",
    operationKind: "call",
    lane: "promise",
    variant: "callback",
    requirements: [{ carrier: { ref: "promise-output" }, capability: "clone" }],
    callback: {
      shape: "direct",
      sourceArgumentIndex: 0,
      fallibleTarget: { form: "receiver-method", name: "try_finally" },
    },
    returnedFuture: { awaiting: "fallible", errorBoundary: "source-program" },
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "receiver-method", name: "finally" },
      result: { ref: "source-result" },
      params: [{ ref: "promise-finally-callback" }],
    },
  },
  ...(["PromiseFulfilledResult", "PromiseRejectedResult"] as const).map(
    (owner): JsOperationRowData => ({
      owner,
      member: "status",
      operationKind: "property",
      lane: "promise-record",
      shape: {
        op: "operation",
        operationKind: "property",
        target: { form: "field", name: "status" },
        result: { ref: "string" },
        evaluation: "pure",
      },
    }),
  ),
  {
    owner: "PromiseFulfilledResult",
    member: "value",
    operationKind: "property",
    lane: "promise-record",
    shape: {
      op: "operation",
      operationKind: "property",
      target: { form: "field", name: "value" },
      result: { ref: "source-result" },
      evaluation: "pure",
    },
  },
  {
    owner: "PromiseRejectedResult",
    member: "reason",
    operationKind: "property",
    lane: "promise-record",
    shape: {
      op: "operation",
      operationKind: "property",
      target: { form: "field", name: "reason" },
      result: { ref: "source-result" },
      evaluation: "pure",
    },
  },
];

const jsonRows: readonly JsOperationRowData[] = ([
  ...(["null", "undefined"] as const).flatMap((replacer): readonly JsOperationRowData[] => [
    {
      owner: "JSON",
      member: "stringify",
      operationKind: "call",
      lane: "json",
      variant: `${replacer}-replacer`,
      fallible: true,
      compileTimeSourceArgumentIndexes: [1],
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "call", path: "js_abi::json_stringify", argModes: ["ref"], argOrder: [0] },
        result: { ref: "option-of-string" },
        params: [{ ref: "jsvalue" }, { ref: replacer }],
      },
    },
    {
      owner: "JSON",
      member: "stringify",
      operationKind: "call",
      lane: "json",
      variant: `${replacer}-replacer-number-space`,
      fallible: true,
      compileTimeSourceArgumentIndexes: [1],
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "call", path: "js_abi::json_stringify_with_space_number", argModes: ["ref", "value"], argOrder: [0, 2] },
        result: { ref: "option-of-string" },
        params: [{ ref: "jsvalue" }, { ref: replacer }, { ref: "float64" }],
      },
    },
    {
      owner: "JSON",
      member: "stringify",
      operationKind: "call",
      lane: "json",
      variant: `${replacer}-replacer-string-space`,
      fallible: true,
      compileTimeSourceArgumentIndexes: [1],
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "call", path: "js_abi::json_stringify_with_space_string", argModes: ["ref", "ref"], argOrder: [0, 2] },
        result: { ref: "option-of-string" },
        params: [{ ref: "jsvalue" }, { ref: replacer }, { ref: "string" }],
      },
    },
    {
      owner: "JSON",
      member: "stringify",
      operationKind: "call",
      lane: "json",
      variant: `${replacer}-replacer-undefined-space`,
      fallible: true,
      compileTimeSourceArgumentIndexes: [1, 2],
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "call", path: "js_abi::json_stringify", argModes: ["ref"], argOrder: [0] },
        result: { ref: "option-of-string" },
        params: [{ ref: "jsvalue" }, { ref: replacer }, { ref: "undefined" }],
      },
    },
  ]),
  {
    owner: "JSON",
    member: "stringify",
    operationKind: "call",
    lane: "json",
    variant: "callback-replacer",
    fallible: true,
    callback: {
      shape: "direct",
      sourceArgumentIndex: 1,
      fallibleTarget: { form: "call", path: "js_abi::json_try_stringify_with_replacer", argModes: ["ref", "value"] },
    },
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "call", path: "js_abi::json_stringify_with_replacer", argModes: ["ref", "value"] },
      result: { ref: "option-of-string" },
      params: [{ ref: "jsvalue" }, { ref: "json-replacer-callback" }],
    },
  },
  ...(["number", "string"] as const).map((space): JsOperationRowData => ({
    owner: "JSON",
    member: "stringify",
    operationKind: "call",
    lane: "json",
    variant: `callback-replacer-${space}-space`,
    fallible: true,
    callback: {
      shape: "direct",
      sourceArgumentIndex: 1,
      fallibleTarget: {
        form: "call",
        path: space === "number"
          ? "js_abi::json_try_stringify_with_replacer_and_space_number"
          : "js_abi::json_try_stringify_with_replacer_and_space_string",
        argModes: ["ref", "value", space === "number" ? "value" : "ref"],
      },
    },
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "call",
        path: space === "number"
          ? "js_abi::json_stringify_with_replacer_and_space_number"
          : "js_abi::json_stringify_with_replacer_and_space_string",
        argModes: ["ref", "value", space === "number" ? "value" : "ref"],
      },
      result: { ref: "option-of-string" },
      params: [
        { ref: "jsvalue" },
        { ref: "json-replacer-callback" },
        { ref: space === "number" ? "float64" : "string" },
      ],
    },
  })),
  {
    owner: "JSON",
    member: "stringify",
    operationKind: "call",
    lane: "json",
    variant: "callback-replacer-undefined-space",
    fallible: true,
    compileTimeSourceArgumentIndexes: [2],
    callback: {
      shape: "direct",
      sourceArgumentIndex: 1,
      fallibleTarget: { form: "call", path: "js_abi::json_try_stringify_with_replacer", argModes: ["ref", "value"], argOrder: [0, 1] },
    },
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "call", path: "js_abi::json_stringify_with_replacer", argModes: ["ref", "value"], argOrder: [0, 1] },
      result: { ref: "option-of-string" },
      params: [{ ref: "jsvalue" }, { ref: "json-replacer-callback" }, { ref: "undefined" }],
    },
  },
  {
    owner: "JSON",
    member: "stringify",
    operationKind: "call",
    lane: "json",
    variant: "property-list-replacer",
    fallible: true,
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "call", path: "js_abi::json_stringify_with_property_list", argModes: ["ref", "ref"] },
      result: { ref: "option-of-string" },
      params: [{ ref: "jsvalue" }, { ref: "jsvalue" }],
    },
  },
  ...(["number", "string"] as const).map((space): JsOperationRowData => ({
    owner: "JSON",
    member: "stringify",
    operationKind: "call",
    lane: "json",
    variant: `property-list-replacer-${space}-space`,
    fallible: true,
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "call",
        path: space === "number"
          ? "js_abi::json_stringify_with_property_list_and_space_number"
          : "js_abi::json_stringify_with_property_list_and_space_string",
        argModes: ["ref", "ref", space === "number" ? "value" : "ref"],
      },
      result: { ref: "option-of-string" },
      params: [
        { ref: "jsvalue" },
        { ref: "jsvalue" },
        { ref: space === "number" ? "float64" : "string" },
      ],
    },
  })),
] satisfies readonly JsOperationRowData[]).map((row) => ({
  ...row,
  jsonValueSourceArgumentIndexes: [0],
}));

export const jsCapabilityOperationRows: readonly JsOperationRowData[] = [
  ...symbolRows,
  ...weakCollectionRows,
  ...arrayBufferRows,
  ...dataViewRows,
  ...typedArrayRows,
  ...intlRows,
  ...consoleRows,
  ...timerRows,
  ...promiseRows,
  ...jsonRows,
];

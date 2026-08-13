import type { TargetTypeRef } from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type {
  RustCallbackOperationTemplate,
  RustProviderOperationForm,
  RustProviderOperationTemplate,
  RustRuntimeSetTemplate,
  RustValueConversion,
} from "../rust-facts/keys.js";
import {
  rustInt32ToFloat64ValueConversion,
  rustInt32ToUsizeValueConversion,
  rustIsizeToFloat64ValueConversion,
  rustIsizeToInt32ValueConversion,
  rustUsizeToInt32ValueConversion,
} from "../rust-facts/value-conversions.js";
import {
  getRustJsMapTargetTypes,
  getRustJsSetElementTargetType,
  rustCarrierSupportsClone,
  rustCarrierSupportsJsEquality,
  isRustIntegerCarrier,
  isRustJsArrayCarrier,
  isRustSourceStringConvertibleCarrier,
  rustJsValueTargetType,
  rustStringTargetId,
  rustVecTargetType,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustJsDateTargetId,
  rustJsDateTargetType,
  rustJsArrayConcatItemTargetType,
  rustJsArrayTargetType,
  rustJsMapTargetType,
  rustJsSetTargetType,
  rustClosureTargetType,
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
  readonly authoredMethodTypeArgumentCarriers?: readonly (TargetTypeRef | undefined)[];
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
  readonly callback?: RustCallbackOperationTemplate;
}

type JsLane = "js-array" | "string" | "map" | "set" | "date" | "json" | "math" | "number" | "global" | "console" | "object" | "regexp" | "regexp-match";

type JsCarrierRef =
  | { readonly ref: "cb-array-predicate"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "cb-array-map"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "cb-array-reduce"; readonly arity: 0 | 1 | 2 | 3 | 4 }
  | { readonly ref: "cb-array-reduce-first"; readonly arity: 0 | 1 | 2 | 3 | 4 }
  | { readonly ref: "cb-array-for-each"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "cb-map-for-each"; readonly arity: 0 | 1 | 2 | 3 }
  | { readonly ref: "cb-set-for-each"; readonly arity: 0 | 1 | 2 | 3 }
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
  | { readonly ref: "map-key-array" }
  | { readonly ref: "map-value-array" }
  | { readonly ref: "map-entry-array" }
  | { readonly ref: "set-value" }
  | { readonly ref: "set-value-array" }
  | { readonly ref: "set-entry-array" }
  | { readonly ref: "argument"; readonly index: number };

type JsCarrierCapability = "numeric" | "integer" | "clone" | "stringifiable" | "js-equality";

interface JsOperationRowData {
  readonly owner: string;
  readonly member: string;
  readonly operationKind: JsOperationRequest["operationKind"];
  readonly lane: JsLane;
  readonly variant?: string;
  readonly requirements?: readonly {
    readonly carrier: JsCarrierRef;
    readonly capability: JsCarrierCapability;
  }[];
  readonly callback?: RustCallbackOperationTemplate;
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

function defineJsOperationRows(rows: readonly JsOperationRowData[]): readonly JsOperationRowData[] {
  const identities = new Set<string>();
  const variantsByOperation = new Map<string, string[]>();
  for (const row of rows) {
    const operation = `${row.owner}|${row.member}|${row.operationKind}|${row.lane}`;
    const variant = row.variant ?? "";
    const identity = `${operation}|${variant}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate JavaScript operation row '${identity}'.`);
    }
    identities.add(identity);
    variantsByOperation.set(operation, [...(variantsByOperation.get(operation) ?? []), variant]);
  }
  for (const [operation, variants] of variantsByOperation) {
    if (variants.length > 1 && variants.some((variant) => variant.length === 0)) {
      throw new Error(`JavaScript operation rows for '${operation}' require explicit variants.`);
    }
  }
  return Object.freeze([...rows]);
}

const zeroArgument = { kind: "integer", value: 0 } as const;
const noneArgument = { kind: "none" } as const;
export const rustInferCarrier: TargetTypeRef = { kind: "opaque", id: "tsonic.rust.infer" };
const jsNumberArgumentRows = [
  { variant: "float64", carrier: { ref: "float64" } as const, conversion: undefined },
  { variant: "int32", carrier: { ref: "int32" } as const, conversion: rustInt32ToFloat64ValueConversion },
] as const;
const jsNumberArgumentPairs = jsNumberArgumentRows.flatMap((first) =>
  jsNumberArgumentRows.map((second) => ({ first, second }))
);
const mapForEachRows = [
  { arity: 0, variant: "zero", targetName: "for_each_zero" },
  { arity: 1, variant: "value", targetName: "for_each_value" },
  { arity: 2, variant: "value-key", targetName: "for_each_value_key" },
  { arity: 3, variant: "value-key-map", targetName: "for_each" },
] as const;
const setForEachRows = [
  { arity: 0, variant: "zero", targetName: "for_each_zero" },
  { arity: 1, variant: "value", targetName: "for_each_value" },
  { arity: 2, variant: "value-key", targetName: "for_each_value_key" },
  { arity: 3, variant: "value-key-set", targetName: "for_each" },
] as const;
const arrayCallbackRows = [
  { arity: 0, variant: "zero", suffix: "_zero" },
  { arity: 1, variant: "value", suffix: "" },
  { arity: 2, variant: "value-index", suffix: "_with_index" },
  { arity: 3, variant: "value-index-array", suffix: "_with_array" },
] as const;
const arrayReduceCallbackRows = [
  { arity: 0, variant: "zero", suffix: "_zero" },
  { arity: 1, variant: "accumulator", suffix: "_accumulator" },
  { arity: 2, variant: "accumulator-value", suffix: "" },
  { arity: 3, variant: "accumulator-value-index", suffix: "_with_index" },
  { arity: 4, variant: "accumulator-value-index-array", suffix: "_with_array" },
] as const;
const arrayPredicateRows = [
  { member: "filter", targetName: "filter", result: { ref: "receiver" } as const },
  { member: "find", targetName: "find", result: { ref: "option-of-element" } as const },
  { member: "findIndex", targetName: "find_index", result: { ref: "float64" } as const, resultConversion: rustIsizeToFloat64ValueConversion },
  { member: "findLast", targetName: "find_last", result: { ref: "option-of-element" } as const },
  { member: "findLastIndex", targetName: "find_last_index", result: { ref: "float64" } as const, resultConversion: rustIsizeToFloat64ValueConversion },
  { member: "some", targetName: "some", result: { ref: "bool" } as const },
  { member: "every", targetName: "every", result: { ref: "bool" } as const },
] as const;

function callbackOperation(
  shape: RustCallbackOperationTemplate["shape"],
  targetName: string,
  targetOptions: Omit<
    Extract<RustProviderOperationForm, { readonly form: "receiver-method" }>,
    "form" | "name"
  > = {},
): RustCallbackOperationTemplate {
  return {
    shape,
    sourceArgumentIndex: 0,
    ...(shape === "reduce" ? { accumulatorArgumentIndex: 1 } : {}),
    fallibleTarget: {
      form: "receiver-method",
      name: `try_${targetName}`,
      ...targetOptions,
    },
  };
}
const numberPredicateRows = [
  { member: "isFinite", path: "js_abi::number_is_finite" },
  { member: "isInteger", path: "js_abi::number_is_integer" },
  { member: "isNaN", path: "js_abi::number_is_nan" },
  { member: "isSafeInteger", path: "js_abi::number_is_safe_integer" },
] as const;
const numberPropertyRows = [
  { member: "MAX_VALUE", path: "js_abi::NUMBER_MAX_VALUE" },
  { member: "MIN_VALUE", path: "js_abi::NUMBER_MIN_VALUE" },
  { member: "NaN", path: "js_abi::NUMBER_NAN" },
  { member: "NEGATIVE_INFINITY", path: "js_abi::NUMBER_NEGATIVE_INFINITY" },
  { member: "POSITIVE_INFINITY", path: "js_abi::NUMBER_POSITIVE_INFINITY" },
  { member: "MAX_SAFE_INTEGER", path: "js_abi::NUMBER_MAX_SAFE_INTEGER" },
  { member: "MIN_SAFE_INTEGER", path: "js_abi::NUMBER_MIN_SAFE_INTEGER" },
  { member: "EPSILON", path: "js_abi::NUMBER_EPSILON" },
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
  { owner, member: "includes", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes_from_start", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "element" }] } },
  { owner, member: "includes", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes", argModes: ["ref", "value"] }, result: { ref: "bool" }, params: [{ ref: "element" }, { ref: "float64" }] } },
  { owner, member: "indexOf", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of_from_start", argModes: ["ref"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner, member: "indexOf", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of", argModes: ["ref", "value"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }, { ref: "float64" }] } },
  { owner, member: "lastIndexOf", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "last_index_of_from_end", argModes: ["ref"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner, member: "lastIndexOf", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "last_index_of", argModes: ["ref", "value"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }, { ref: "float64" }] } },
  { owner, member: "index", operationKind: "indexer", lane: "js-array", variant: "number", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get_number", argModes: ["value"] }, result: { ref: "option-of-element" }, params: [{ ref: "float64" }] } },
  { owner, member: "index", operationKind: "indexer", lane: "js-array", variant: "int32", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get_number", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "option-of-element" }, params: [{ ref: "int32" }] } },
  ...arrayPredicateRows.flatMap((predicateRow) =>
    arrayCallbackRows.map(({ arity, variant, suffix }): JsOperationRowData => ({
      owner,
      member: predicateRow.member,
      operationKind: "call",
      lane: "js-array",
      variant,
      callback: callbackOperation("direct", `${predicateRow.targetName}${suffix}`),
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "receiver-method", name: `${predicateRow.targetName}${suffix}` },
        result: predicateRow.result,
        ...("resultConversion" in predicateRow
          ? { resultConversion: predicateRow.resultConversion }
          : {}),
        params: [{ ref: "cb-array-predicate", arity }],
      },
    }))
  ),
  ...arrayCallbackRows.map(({ arity, variant, suffix }): JsOperationRowData => ({
    owner,
    member: "map",
    operationKind: "call",
    lane: "js-array",
    variant,
    selectedMethodTypeArgumentArity: 1,
    callback: callbackOperation("map", `map${suffix}`),
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "receiver-method", name: `map${suffix}` },
      result: { ref: "receiver" },
      params: [{ ref: "cb-array-map", arity }],
    },
  })),
  ...arrayCallbackRows.map(({ arity, variant }): JsOperationRowData => {
    const targetName = ["for_each_zero", "for_each_value", "for_each_value_index", "for_each"][arity]!;
    return {
    owner,
    member: "forEach",
    operationKind: "call",
    lane: "js-array",
    variant,
    callback: callbackOperation("direct", targetName),
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "receiver-method",
        name: targetName,
      },
      result: { ref: "unit" },
      params: [{ ref: "cb-array-for-each", arity }],
    },
    };
  }),
  { owner, member: "slice", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_all" }, result: { ref: "element-array" } } },
  { owner, member: "slice", operationKind: "call", lane: "js-array", variant: "start", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_from" }, result: { ref: "element-array" }, params: [{ ref: "float64" }] } },
  { owner, member: "slice", operationKind: "call", lane: "js-array", variant: "start-end", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_to" }, result: { ref: "element-array" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner, member: "concat", operationKind: "call", lane: "js-array", variadic: true, requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-tagged-array", name: "concat", receiverMode: "ref", leadingArguments: [], elementCarrier: rustJsArrayConcatItemTargetType(rustInferCarrier), alternatives: [{ inputCarrier: rustInferCarrier, mode: "value", constructorPath: "js_abi::JsArrayConcatItem::Value" }, { inputCarrier: rustJsArrayTargetType(rustInferCarrier), mode: "value", constructorPath: "js_abi::JsArrayConcatItem::Array" }] }, result: { ref: "element-array" } } },
  { owner, member: "join", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "stringifiable" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "join_default" }, result: { ref: "string" } } },
  { owner, member: "join", operationKind: "call", lane: "js-array", variant: "separator", requirements: [{ carrier: { ref: "element" }, capability: "stringifiable" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "join", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
]);

const jsOperationRows = defineJsOperationRows([
  { owner: "ObjectConstructor", member: "is", operationKind: "call", lane: "object", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-array", path: "js_abi::object_is", leadingArguments: [], elementCarrier: rustJsValueTargetType() }, result: { ref: "bool" } } },
  ...sharedArrayOperationRows,
  { owner: "ArrayConstructor", member: "isArray", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::array_is_array_value", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "jsvalue" }] } },
  { owner: "ArrayConstructor", member: "from", operationKind: "call", lane: "js-array", variant: "string", requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::array_from_string", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "string" }] } },
  { owner: "ArrayConstructor", member: "of", operationKind: "call", lane: "js-array", selectedMethodTypeArgumentArity: 1, variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-array", path: "js_abi::array_of", leadingArguments: [], elementCarrier: rustInferCarrier }, result: { ref: "element-array" } } },
  { owner: "Array", member: "length", operationKind: "property-set", lane: "js-array", shape: { op: "set", target: { form: "receiver-method", name: "set_len", argConversions: [rustInt32ToUsizeValueConversion] }, params: [{ ref: "int32" }] } },
  { owner: "Array", member: "push", operationKind: "call", lane: "js-array", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "push_many", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  { owner: "Array", member: "pop", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "pop" }, result: { ref: "option-of-element" } } },
  { owner: "Array", member: "shift", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "shift" }, result: { ref: "option-of-element" } } },
  { owner: "Array", member: "unshift", operationKind: "call", lane: "js-array", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "unshift_many", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  { owner: "Array", member: "splice", operationKind: "call", lane: "js-array", variant: "start", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "splice_from" }, result: { ref: "element-array" }, params: [{ ref: "float64" }] } },
  { owner: "Array", member: "splice", operationKind: "call", lane: "js-array", variant: "delete-and-items", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "splice_many", receiverMode: "ref", leadingArguments: [{ carrier: rustSourcePrimitiveTargetType("float64"), mode: "value" }, { carrier: rustSourcePrimitiveTargetType("float64"), mode: "value" }], elementCarrier: rustInferCarrier }, result: { ref: "element-array" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "Array", member: "reverse", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "reverse" }, result: { ref: "receiver" } } },
  { owner: "Array", member: "sort", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "stringifiable" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "sort_by_js_string" }, result: { ref: "receiver" } } },
  { owner: "Array", member: "fill", operationKind: "call", lane: "js-array", variant: "all", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "fill_all" }, result: { ref: "receiver" }, params: [{ ref: "element" }] } },
  { owner: "Array", member: "fill", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "fill_from" }, result: { ref: "receiver" }, params: [{ ref: "element" }, { ref: "float64" }] } },
  { owner: "Array", member: "fill", operationKind: "call", lane: "js-array", variant: "to", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "fill_to" }, result: { ref: "receiver" }, params: [{ ref: "element" }, { ref: "float64" }, { ref: "float64" }] } },
  { owner: "Array", member: "copyWithin", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "copy_within_from" }, result: { ref: "receiver" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "Array", member: "copyWithin", operationKind: "call", lane: "js-array", variant: "to", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "copy_within_to" }, result: { ref: "receiver" }, params: [{ ref: "float64" }, { ref: "float64" }, { ref: "float64" }] } },
  { owner: "Array", member: "index", operationKind: "index-set", lane: "js-array", variant: "number", shape: { op: "set", target: { form: "receiver-method", name: "set_number" }, params: [{ ref: "float64" }, { ref: "element" }] } },
  { owner: "Array", member: "index", operationKind: "index-set", lane: "js-array", variant: "int32", shape: { op: "set", target: { form: "receiver-method", name: "set_number", argConversions: [rustInt32ToFloat64ValueConversion, undefined] }, params: [{ ref: "int32" }, { ref: "element" }] } },
  { owner: "Array", member: "index", operationKind: "delete", lane: "js-array", variant: "number", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "delete_number" }, result: { ref: "bool" }, params: [{ ref: "float64" }] } },
  { owner: "Array", member: "index", operationKind: "delete", lane: "js-array", variant: "int32", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "delete_number", argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "bool" }, params: [{ ref: "int32" }] } },
  ...arrayReduceCallbackRows.flatMap(({ arity, variant, suffix }): readonly JsOperationRowData[] => [
    {
      owner: "Array",
      member: "reduce",
      operationKind: "call",
      lane: "js-array",
      variant: `from-first-${variant}`,
      selectedMethodTypeArgumentArity: 0,
      fallible: true,
      callback: callbackOperation("direct", `reduce_from_first${suffix}`),
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "receiver-method", name: `reduce_from_first${suffix}` },
        result: { ref: "element" },
        params: [{ ref: "cb-array-reduce-first", arity }],
      },
    },
    {
      owner: "Array",
      member: "reduce",
      operationKind: "call",
      lane: "js-array",
      variant: `element-initial-${variant}`,
      selectedMethodTypeArgumentArity: 0,
      callback: callbackOperation("reduce", `reduce${suffix}`, { argOrder: [1, 0] }),
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "receiver-method", name: `reduce${suffix}`, argOrder: [1, 0] },
        result: { ref: "element" },
        params: [{ ref: "cb-array-reduce", arity }, { ref: "element" }],
      },
    },
    {
      owner: "Array",
      member: "reduce",
      operationKind: "call",
      lane: "js-array",
      variant: `selected-initial-${variant}`,
      selectedMethodTypeArgumentArity: 1,
      callback: callbackOperation("reduce", `reduce${suffix}`, { argOrder: [1, 0] }),
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "receiver-method", name: `reduce${suffix}`, argOrder: [1, 0] },
        result: { ref: "selected-method-type-argument", index: 0 },
        params: [{ ref: "cb-array-reduce", arity }, { ref: "selected-method-type-argument", index: 0 }],
      },
    },
  ]),

  // String lane (runtime string module through the js_string alias).
  { owner: "String", member: "length", operationKind: "property", lane: "string", shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_string::js_len", receiverMode: "ref" }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  ...[
    { member: "includes", target: "includes", defaultTarget: "includes_from_start", result: { ref: "bool" } as const },
    { member: "startsWith", target: "starts_with", defaultTarget: "starts_with_from_start", result: { ref: "bool" } as const },
    { member: "endsWith", target: "ends_with", defaultTarget: "ends_with_at_end", result: { ref: "bool" } as const },
    { member: "indexOf", target: "index_of", defaultTarget: "index_of_from_start", result: { ref: "int32" } as const, resultConversion: rustIsizeToInt32ValueConversion },
    { member: "lastIndexOf", target: "last_index_of", defaultTarget: "last_index_of_from_end", result: { ref: "int32" } as const, resultConversion: rustIsizeToInt32ValueConversion },
  ].flatMap((row): readonly JsOperationRowData[] => [
    {
      owner: "String",
      member: row.member,
      operationKind: "call",
      lane: "string",
      variant: "default",
      shape: {
        op: "operation",
        operationKind: "method",
        target: { form: "free-call", path: `js_string::${row.defaultTarget}`, receiverMode: "ref", argModes: ["ref"] },
        result: row.result,
        ...("resultConversion" in row ? { resultConversion: row.resultConversion } : {}),
        params: [{ ref: "string" }],
      },
    },
    ...jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({
      owner: "String",
      member: row.member,
      operationKind: "call",
      lane: "string",
      variant,
      shape: {
        op: "operation",
        operationKind: "method",
        target: {
          form: "free-call",
          path: `js_string::${row.target}`,
          receiverMode: "ref",
          argModes: ["ref", "value"],
          argConversions: [undefined, conversion],
        },
        result: row.result,
        ...("resultConversion" in row ? { resultConversion: row.resultConversion } : {}),
        params: [{ ref: "string" }, carrier],
      },
    })),
  ]),
  { owner: "String", member: "toUpperCase", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_upper_case", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "toLowerCase", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_lower_case", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "trim", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim", receiverMode: "ref" }, result: { ref: "string" } } },
  ...[{ member: "trimStart" }, { member: "trimLeft" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim_start", receiverMode: "ref" }, result: { ref: "string" } } })),
  ...[{ member: "trimEnd" }, { member: "trimRight" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim_end", receiverMode: "ref" }, result: { ref: "string" } } })),
  ...[{ member: "toString" }, { member: "valueOf" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::identity", receiverMode: "ref" }, result: { ref: "string" } } })),
  { owner: "String", member: "slice", operationKind: "call", lane: "string", variant: "default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice", receiverMode: "ref", trailingArguments: [zeroArgument, noneArgument] }, result: { ref: "string" } } },
  ...jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member: "slice", operationKind: "call", lane: "string", variant: `start-${variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice", receiverMode: "ref", argConversions: [conversion], trailingArguments: [noneArgument] }, result: { ref: "string" }, params: [carrier] } })),
  ...jsNumberArgumentPairs.map(({ first, second }): JsOperationRowData => ({ owner: "String", member: "slice", operationKind: "call", lane: "string", variant: `start-${first.variant}-end-${second.variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice_to", receiverMode: "ref", argConversions: [first.conversion, second.conversion] }, result: { ref: "string" }, params: [first.carrier, second.carrier] } })),
  ...[{ member: "substring" }, { member: "substr" }].flatMap(({ member }): readonly JsOperationRowData[] => [
    ...jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", variant: `start-${variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${member}_from`, receiverMode: "ref", argConversions: [conversion] }, result: { ref: "string" }, params: [carrier] } })),
    ...jsNumberArgumentPairs.map(({ first, second }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", variant: `start-${first.variant}-end-${second.variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${member}`, receiverMode: "ref", argConversions: [first.conversion, second.conversion] }, result: { ref: "string" }, params: [first.carrier, second.carrier] } })),
  ]),
  ...[
    { member: "charAt", target: "char_at", result: { ref: "string" } as const, fallible: true },
    { member: "charCodeAt", target: "char_code_at", result: { ref: "float64" } as const, fallible: false },
    { member: "codePointAt", target: "code_point_at", result: { ref: "option-of-float64" } as const, fallible: false },
    { member: "at", target: "at", result: { ref: "option-of-string" } as const, fallible: true },
    { member: "repeat", target: "repeat", result: { ref: "string" } as const, fallible: true },
  ].flatMap((row) => jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member: row.member, operationKind: "call", lane: "string", variant, ...(row.fallible ? { fallible: true } : {}), shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${row.target}`, receiverMode: "ref", argConversions: [conversion] }, result: row.result, params: [carrier] } }))),
  { owner: "String", member: "split", operationKind: "call", lane: "string", variant: "string-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::split_all", receiverMode: "ref", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "string" }] } },
  ...jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member: "split", operationKind: "call", lane: "string", variant: `string-limit-${variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::split", receiverMode: "ref", argModes: ["ref", "value"], argConversions: [undefined, conversion] }, result: { ref: "string-array" }, params: [{ ref: "string" }, carrier] } })),
  { owner: "String", member: "replace", operationKind: "call", lane: "string", variant: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::replace", receiverMode: "ref", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [{ ref: "string" }, { ref: "string" }] } },
  { owner: "String", member: "replaceAll", operationKind: "call", lane: "string", variant: "string", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::replace_all", receiverMode: "ref", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [{ ref: "string" }, { ref: "string" }] } },
  { owner: "String", member: "concat", operationKind: "call", lane: "string", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call-str-slice", path: "js_string::concat", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "StringConstructor", member: "fromCharCode", operationKind: "call", lane: "string", variadic: true, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_string::from_char_code", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "string" } } },
  { owner: "StringConstructor", member: "fromCodePoint", operationKind: "call", lane: "string", variadic: true, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_string::from_code_point", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "string" } } },

  // Map lane.
  ...(["Map", "ReadonlyMap"] as const).flatMap((owner): readonly JsOperationRowData[] => [
    { owner, member: "get", operationKind: "call", lane: "map", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }, { carrier: { ref: "map-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get", argModes: ["ref"] }, result: { ref: "option-of-map-value" }, params: [{ ref: "map-key" }] } },
    { owner, member: "has", operationKind: "call", lane: "map", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
    { owner, member: "keys", operationKind: "call", lane: "map", requirements: [{ carrier: { ref: "map-key" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "keys" }, result: { ref: "map-key-array" } } },
    { owner, member: "values", operationKind: "call", lane: "map", requirements: [{ carrier: { ref: "map-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "values" }, result: { ref: "map-value-array" } } },
    { owner, member: "entries", operationKind: "call", lane: "map", requirements: [{ carrier: { ref: "map-key" }, capability: "clone" }, { carrier: { ref: "map-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "entries" }, result: { ref: "map-entry-array" } } },
    ...mapForEachRows.map(({ arity, variant, targetName }) => ({
      owner,
      member: "forEach",
      operationKind: "call" as const,
      lane: "map" as const,
      variant,
      requirements: [
        { carrier: { ref: "map-key" } as const, capability: "clone" as const },
        { carrier: { ref: "map-value" } as const, capability: "clone" as const },
      ],
      callback: callbackOperation("direct", targetName),
      shape: { op: "operation" as const, operationKind: "method" as const, target: { form: "receiver-method" as const, name: targetName }, result: { ref: "unit" as const }, params: [{ ref: "cb-map-for-each" as const, arity }] },
    })),
    { owner, member: "size", operationKind: "property", lane: "map", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  ]),
  { owner: "Map", member: "set", operationKind: "call", lane: "map", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "set" }, result: { ref: "receiver" }, params: [{ ref: "map-key" }, { ref: "map-value" }] } },
  { owner: "Map", member: "delete", operationKind: "call", lane: "map", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "clear", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "clear" }, result: { ref: "unit" } } },

  // Set lane.
  ...(["Set", "ReadonlySet"] as const).flatMap((owner): readonly JsOperationRowData[] => [
    { owner, member: "has", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
    { owner, member: "keys", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "keys" }, result: { ref: "set-value-array" } } },
    { owner, member: "values", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "values" }, result: { ref: "set-value-array" } } },
    { owner, member: "entries", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "entries" }, result: { ref: "set-entry-array" } } },
    ...setForEachRows.map(({ arity, variant, targetName }) => ({
      owner,
      member: "forEach",
      operationKind: "call" as const,
      lane: "set" as const,
      variant,
      requirements: [{ carrier: { ref: "set-value" } as const, capability: "clone" as const }],
      callback: callbackOperation("direct", targetName),
      shape: { op: "operation" as const, operationKind: "method" as const, target: { form: "receiver-method" as const, name: targetName }, result: { ref: "unit" as const }, params: [{ ref: "cb-set-for-each" as const, arity }] },
    })),
    { owner, member: "size", operationKind: "property", lane: "set", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  ]),
  { owner: "Set", member: "add", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "add" }, result: { ref: "receiver" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "delete", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "clear", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "clear" }, result: { ref: "unit" } } },

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
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "float64-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start", receiverMode: "ref", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "float64-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start_with", receiverMode: "ref", argModes: ["value", "ref"] }, result: { ref: "string" }, params: [{ ref: "float64" }, { ref: "string" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "int32-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start", receiverMode: "ref", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "int32-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start_with", receiverMode: "ref", argModes: ["value", "ref"], argConversions: [rustInt32ToFloat64ValueConversion, undefined] }, result: { ref: "string" }, params: [{ ref: "int32" }, { ref: "string" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "float64-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end", receiverMode: "ref", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "float64-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end_with", receiverMode: "ref", argModes: ["value", "ref"] }, result: { ref: "string" }, params: [{ ref: "float64" }, { ref: "string" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "int32-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end", receiverMode: "ref", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "int32-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end_with", receiverMode: "ref", argModes: ["value", "ref"], argConversions: [rustInt32ToFloat64ValueConversion, undefined] }, result: { ref: "string" }, params: [{ ref: "int32" }, { ref: "string" }] } },
  { owner: "String", member: "matchAll", operationKind: "call", lane: "string", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "match_all", argModes: ["ref"] }, result: { ref: "regexp-match-vec" }, params: [undefined] } },
  { owner: "String", member: "replace", operationKind: "call", lane: "string", variant: "regexp", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "replace", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [undefined, { ref: "string" }] } },
  { owner: "String", member: "search", operationKind: "call", lane: "string", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "search", argModes: ["ref"] }, result: { ref: "int32" }, params: [undefined] } },
  { owner: "String", member: "split", operationKind: "call", lane: "string", variant: "regexp", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "split", argModes: ["ref"] }, result: { ref: "string-array" }, params: [undefined] } },

  // Set algebra.
  ...(["Set", "ReadonlySet"] as const).flatMap((owner): readonly JsOperationRowData[] => [
    { owner, member: "union", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }, { carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "union", argModes: ["ref"] }, result: { ref: "receiver" }, params: [{ ref: "receiver" }] } },
    { owner, member: "intersection", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }, { carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "intersection", argModes: ["ref"] }, result: { ref: "receiver" }, params: [{ ref: "receiver" }] } },
    { owner, member: "difference", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }, { carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "difference", argModes: ["ref"] }, result: { ref: "receiver" }, params: [{ ref: "receiver" }] } },
    { owner, member: "symmetricDifference", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }, { carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "symmetric_difference", argModes: ["ref"] }, result: { ref: "receiver" }, params: [{ ref: "receiver" }] } },
    { owner, member: "isSubsetOf", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }, { carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "is_subset_of", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "receiver" }] } },
    { owner, member: "isSupersetOf", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }, { carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "is_superset_of", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "receiver" }] } },
    { owner, member: "isDisjointFrom", operationKind: "call", lane: "set", requirements: [{ carrier: { ref: "set-value" }, capability: "clone" }, { carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "is_disjoint_from", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "receiver" }] } },
  ]),

  // Math lane. Exact f64 operations lower directly; operations with distinct
  // ECMAScript edge semantics use closed runtime helpers.
  { owner: "Math", member: "floor", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "floor" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "ceil", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "ceil" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "clz32", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_clz32" }, result: { ref: "float64" }, resultConversion: rustInt32ToFloat64ValueConversion, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "trunc", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "trunc" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "abs", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "abs" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "acos", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "acos" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "acosh", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "acosh" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "asin", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "asin" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "asinh", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "asinh" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "atan", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "atan" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "atanh", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "atanh" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "atan2", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "atan2" }, result: { ref: "float64" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "Math", member: "cbrt", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "cbrt" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "cos", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "cos" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "cosh", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "cosh" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "exp", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "exp" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "expm1", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "exp_m1" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "fround", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_fround" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "hypot", operationKind: "call", lane: "math", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_abi::math_hypot", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "float64" } } },
  { owner: "Math", member: "imul", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_imul" }, result: { ref: "float64" }, resultConversion: rustInt32ToFloat64ValueConversion, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "Math", member: "log", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "ln" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "log1p", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "ln_1p" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "log10", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "log10" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "log2", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "log2" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "sqrt", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "sqrt" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "pow", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_pow" }, result: { ref: "float64" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "Math", member: "round", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_round" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "sign", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_sign" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "sin", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "sin" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "sinh", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "sinh" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "tan", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "tan" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "tanh", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "tanh" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "max", operationKind: "call", lane: "math", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_abi::math_max", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "float64" } } },
  { owner: "Math", member: "min", operationKind: "call", lane: "math", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_abi::math_min", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "float64" } } },
  { owner: "Math", member: "random", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_random" }, result: { ref: "float64" } } },
  ...([
    ["E", "js_abi::MATH_E"],
    ["LN2", "js_abi::MATH_LN2"],
    ["LN10", "js_abi::MATH_LN10"],
    ["LOG2E", "js_abi::MATH_LOG2E"],
    ["LOG10E", "js_abi::MATH_LOG10E"],
    ["PI", "js_abi::MATH_PI"],
    ["SQRT1_2", "js_abi::MATH_SQRT1_2"],
    ["SQRT2", "js_abi::MATH_SQRT2"],
  ] as const).map(([member, path]): JsOperationRowData => ({ owner: "Math", member, operationKind: "property", lane: "math", shape: { op: "operation", operationKind: "property", target: { form: "path", path }, result: { ref: "float64" } } })),

  ...numberPredicateRows.flatMap(({ member, path }) => [
    { owner: "NumberConstructor", member, operationKind: "call" as const, lane: "number" as const, variant: "float64", shape: { op: "operation" as const, operationKind: "method" as const, target: { form: "call" as const, path }, result: { ref: "bool" as const }, params: [{ ref: "float64" as const }] } },
    { owner: "NumberConstructor", member, operationKind: "call" as const, lane: "number" as const, variant: "int32", shape: { op: "operation" as const, operationKind: "method" as const, target: { form: "call" as const, path, argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "bool" as const }, params: [{ ref: "int32" as const }] } },
  ]),
  { owner: "NumberConstructor", member: "parseFloat", operationKind: "call", lane: "number", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_float", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "NumberConstructor", member: "parseInt", operationKind: "call", lane: "number", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "NumberConstructor", member: "parseInt", operationKind: "call", lane: "number", variant: "float64-radix", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int_radix", argModes: ["ref", "value"] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "float64" }] } },
  { owner: "NumberConstructor", member: "parseInt", operationKind: "call", lane: "number", variant: "int32-radix", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int_radix", argModes: ["ref", "value"], argConversions: [undefined, rustInt32ToFloat64ValueConversion] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "int32" }] } },
  ...numberPropertyRows.map(({ member, path }): JsOperationRowData => ({ owner: "NumberConstructor", member, operationKind: "property", lane: "number", shape: { op: "operation", operationKind: "property", target: { form: "path", path }, result: { ref: "float64" } } })),

  { owner: "Number", member: "toString", operationKind: "call", lane: "number", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_string", receiverMode: "value" }, result: { ref: "string" } } },
  { owner: "Number", member: "toString", operationKind: "call", lane: "number", variant: "float64-radix", fallible: true, requirements: [{ carrier: { ref: "receiver" }, capability: "integer" }], shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_string_radix", receiverMode: "value", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "Number", member: "toString", operationKind: "call", lane: "number", variant: "int32-radix", fallible: true, requirements: [{ carrier: { ref: "receiver" }, capability: "integer" }], shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_string_radix", receiverMode: "value", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "Number", member: "valueOf", operationKind: "call", lane: "number", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_value_of", receiverMode: "value" }, result: { ref: "receiver" } } },
  { owner: "Number", member: "toFixed", operationKind: "call", lane: "number", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_fixed", receiverMode: "value" }, result: { ref: "string" } } },
  { owner: "Number", member: "toFixed", operationKind: "call", lane: "number", variant: "float64-digits", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_fixed_digits", receiverMode: "value", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "Number", member: "toFixed", operationKind: "call", lane: "number", variant: "int32-digits", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_fixed_digits", receiverMode: "value", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "Number", member: "toExponential", operationKind: "call", lane: "number", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_exponential", receiverMode: "value" }, result: { ref: "string" } } },
  { owner: "Number", member: "toExponential", operationKind: "call", lane: "number", variant: "float64-digits", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_exponential_digits", receiverMode: "value", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "Number", member: "toExponential", operationKind: "call", lane: "number", variant: "int32-digits", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_exponential_digits", receiverMode: "value", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "Number", member: "toPrecision", operationKind: "call", lane: "number", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_precision", receiverMode: "value" }, result: { ref: "string" } } },
  { owner: "Number", member: "toPrecision", operationKind: "call", lane: "number", variant: "float64-precision", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_precision_digits", receiverMode: "value", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "Number", member: "toPrecision", operationKind: "call", lane: "number", variant: "int32-precision", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::number_to_precision_digits", receiverMode: "value", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },

  { owner: "Global", member: "parseFloat", operationKind: "call", lane: "global", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_float", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "Global", member: "parseInt", operationKind: "call", lane: "global", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "Global", member: "parseInt", operationKind: "call", lane: "global", variant: "float64-radix", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int_radix", argModes: ["ref", "value"] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "float64" }] } },
  { owner: "Global", member: "parseInt", operationKind: "call", lane: "global", variant: "int32-radix", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int_radix", argModes: ["ref", "value"], argConversions: [undefined, rustInt32ToFloat64ValueConversion] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "int32" }] } },
  ...numberPredicateRows.filter(({ member }) => member === "isNaN" || member === "isFinite").flatMap(({ member, path }) => [
    { owner: "Global", member, operationKind: "call" as const, lane: "global" as const, variant: "float64", shape: { op: "operation" as const, operationKind: "method" as const, target: { form: "call" as const, path }, result: { ref: "bool" as const }, params: [{ ref: "float64" as const }] } },
    { owner: "Global", member, operationKind: "call" as const, lane: "global" as const, variant: "int32", shape: { op: "operation" as const, operationKind: "method" as const, target: { form: "call" as const, path, argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "bool" as const }, params: [{ ref: "int32" as const }] } },
  ]),

  // Date lane.
  { owner: "DateConstructor", member: "parse", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::parse", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "DateConstructor", member: "UTC", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::utc" }, result: { ref: "float64" }, params: [{ ref: "float64" }, { ref: "float64" }, { ref: "float64" }, { ref: "float64" }, { ref: "float64" }, { ref: "float64" }, { ref: "float64" }] } },
  { owner: "Date", member: "toJSON", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_json" }, result: { ref: "string" } } },
  { owner: "Date", member: "valueOf", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_time" }, result: { ref: "float64" } } },
  { owner: "DateConstructor", member: "now", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::now" }, result: { ref: "float64" } } },
  { owner: "Date", member: "toISOString", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_iso_string" }, result: { ref: "string" } } },
  { owner: "Date", member: "getTime", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_time" }, result: { ref: "float64" } } },
]);

interface JsLaneBindings {
  readonly element?: TargetTypeRef;
  readonly mapKey?: TargetTypeRef;
  readonly mapValue?: TargetTypeRef;
  readonly setValue?: TargetTypeRef;
  readonly receiver?: TargetTypeRef;
  readonly selectedMethodTypeArguments?: readonly (TargetTypeRef | undefined)[];
  readonly authoredMethodTypeArguments?: readonly (TargetTypeRef | undefined)[];
  readonly arguments?: readonly (TargetTypeRef | undefined)[];
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
    const mapTypes = getRustJsMapTargetTypes(carrier);
    if (mapTypes !== undefined) {
      return { lane: "map", bindings: { mapKey: mapTypes.key, mapValue: mapTypes.value, receiver: carrier } };
    }
    const setValue = getRustJsSetElementTargetType(carrier);
    if (setValue !== undefined) {
      return { lane: "set", bindings: { setValue, receiver: carrier } };
    }
    if (carrier.id === rustJsDateTargetId) {
      return { lane: "date", bindings: { receiver: carrier } };
    }
  }
  if (isRustStringCarrier(carrier)) {
    return { lane: "string", bindings: { receiver: carrier } };
  }
  if (isRustNumericCarrier(carrier)) {
    return { lane: "number", bindings: { receiver: carrier } };
  }
  // Static owners have no receiver carrier; the lane comes from the owner row.
  if (carrier === undefined && ownerName === "StringConstructor") {
    return { lane: "string", bindings: {} };
  }
  if (carrier === undefined && ownerName === "ArrayConstructor") {
    return { lane: "js-array", bindings: {} };
  }
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
  if (carrier === undefined && ownerName === "Global") {
    return { lane: "global", bindings: {} };
  }
  if (carrier === undefined && ownerName === "Console") {
    return { lane: "console", bindings: {} };
  }
  if (carrier === undefined && ownerName === "ObjectConstructor") {
    return { lane: "object", bindings: {} };
  }
  if (carrier?.kind === "target-named" && carrier.id === "rust.js.JsRegExp") {
    return { lane: "regexp", bindings: { receiver: carrier } };
  }
  if (carrier?.kind === "target-named" && carrier.id === "rust.js.JsRegExpMatch") {
    return { lane: "regexp-match", bindings: { receiver: carrier } };
  }
  return undefined;
}

function resolveCarrierRef(reference: JsCarrierRef, bindings: JsLaneBindings): TargetTypeRef | undefined {
  switch (reference.ref) {
    case "cb-array-predicate":
      return arrayCallbackCarrier(bindings, reference.arity, rustSourcePrimitiveTargetType("bool"));
    case "cb-array-map":
      return arrayCallbackCarrier(
        bindings,
        reference.arity,
        bindings.authoredMethodTypeArguments?.[0] ?? rustInferCarrier,
      );
    case "cb-array-for-each":
      return arrayCallbackCarrier(bindings, reference.arity, rustUnitTargetType());
    case "cb-array-reduce":
      return arrayReduceCallbackCarrier(bindings, reference.arity, rustInferCarrier);
    case "cb-array-reduce-first":
      return bindings.element === undefined
        ? undefined
        : arrayReduceCallbackCarrier(bindings, reference.arity, bindings.element);
    case "cb-map-for-each": {
      const args = [bindings.mapValue, bindings.mapKey, bindings.receiver].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(args as TargetTypeRef[], rustUnitTargetType());
    }
    case "cb-set-for-each": {
      const args = [bindings.setValue, bindings.setValue, bindings.receiver].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(args as TargetTypeRef[], rustUnitTargetType());
    }
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
    case "map-key-array":
      return bindings.mapKey === undefined ? undefined : rustVecTargetType(bindings.mapKey);
    case "map-value-array":
      return bindings.mapValue === undefined ? undefined : rustVecTargetType(bindings.mapValue);
    case "map-entry-array":
      return bindings.mapKey === undefined || bindings.mapValue === undefined
        ? undefined
        : rustVecTargetType({ kind: "tuple", elements: [bindings.mapKey, bindings.mapValue] });
    case "set-value":
      return bindings.setValue;
    case "set-value-array":
      return bindings.setValue === undefined ? undefined : rustVecTargetType(bindings.setValue);
    case "set-entry-array":
      return bindings.setValue === undefined
        ? undefined
        : rustVecTargetType({ kind: "tuple", elements: [bindings.setValue, bindings.setValue] });
    case "argument":
      return bindings.arguments?.[reference.index];
  }
}

function arrayCallbackCarrier(
  bindings: JsLaneBindings,
  arity: 0 | 1 | 2 | 3,
  result: TargetTypeRef,
): TargetTypeRef | undefined {
  const args = [bindings.element, rustSourcePrimitiveTargetType("float64"), bindings.receiver].slice(0, arity);
  return args.some((argument) => argument === undefined)
    ? undefined
    : rustClosureTargetType(args as TargetTypeRef[], result);
}

function arrayReduceCallbackCarrier(
  bindings: JsLaneBindings,
  arity: 0 | 1 | 2 | 3 | 4,
  accumulator: TargetTypeRef,
): TargetTypeRef | undefined {
  const args = [
    accumulator,
    bindings.element,
    rustSourcePrimitiveTargetType("float64"),
    bindings.receiver,
  ].slice(0, arity);
  return args.some((argument) => argument === undefined)
    ? undefined
    : rustClosureTargetType(args as TargetTypeRef[], accumulator);
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

function materializeVariadicTarget(
  target: RustProviderOperationForm,
  elementCarrier: TargetTypeRef | undefined,
): RustProviderOperationForm | undefined {
  if (target.form === "receiver-tagged-array") {
    if (elementCarrier === undefined) {
      return undefined;
    }
    return {
      ...target,
      elementCarrier: materializeInferredCarrier(target.elementCarrier, elementCarrier),
      alternatives: target.alternatives.map((alternative) => ({
        ...alternative,
        inputCarrier: materializeInferredCarrier(alternative.inputCarrier, elementCarrier),
      })),
    };
  }
  if (target.form !== "receiver-value-array" && target.form !== "call-value-array") {
    return target;
  }
  const resolvedElementCarrier = target.elementCarrier.kind === "opaque" &&
    target.elementCarrier.id === "tsonic.rust.infer"
    ? elementCarrier
    : target.elementCarrier;
  return resolvedElementCarrier === undefined
    ? undefined
    : { ...target, elementCarrier: resolvedElementCarrier };
}

function materializeInferredCarrier(carrier: TargetTypeRef, inferred: TargetTypeRef): TargetTypeRef {
  if (carrier.kind === "opaque" && carrier.id === "tsonic.rust.infer") {
    return inferred;
  }
  switch (carrier.kind) {
    case "target-named":
      return carrier.typeArguments === undefined
        ? carrier
        : { ...carrier, typeArguments: carrier.typeArguments.map((argument) => materializeInferredCarrier(argument, inferred)) };
    case "array":
      return { ...carrier, element: materializeInferredCarrier(carrier.element, inferred) };
    case "tuple":
      return { ...carrier, elements: carrier.elements.map((element) => materializeInferredCarrier(element, inferred)) };
    case "pointer":
      return { ...carrier, pointee: materializeInferredCarrier(carrier.pointee, inferred) };
    case "function-pointer":
    case "closure":
      return {
        ...carrier,
        args: carrier.args.map((argument) => materializeInferredCarrier(argument, inferred)),
        result: materializeInferredCarrier(carrier.result, inferred),
      };
    case "associated-type":
      return { ...carrier, owner: materializeInferredCarrier(carrier.owner, inferred) };
    default:
      return carrier;
  }
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
    authoredMethodTypeArguments: request.authoredMethodTypeArgumentCarriers,
    arguments: request.argumentCarriers,
    ...(lane === "js-array" && laneMatch.bindings.element === undefined &&
        request.selectedMethodTypeArgumentCarriers?.length === 1 &&
        request.selectedMethodTypeArgumentCarriers[0] !== undefined
      ? { element: request.selectedMethodTypeArgumentCarriers[0] }
      : {}),
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
      carrierRequirementsMatch(candidate.requirements, bindings) &&
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
    if ((candidate.variadic !== true && parameterCarriers.length !== argumentCarriers.length) ||
      (candidate.variadic === true && argumentCarriers.length < parameterCarriers.length)) {
      return [];
    }
    const argumentScores = parameterCarriers.map((carrier, index) =>
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
  const target = materializeVariadicTarget(row.shape.target, bindings.element);
  if (target === undefined) {
    return undefined;
  }
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
        target,
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
  const callback = row.callback === undefined
    ? undefined
    : {
        ...row.callback,
        fallibleTarget: materializeTarget(row.callback.fallibleTarget, copyReference),
      };
  return {
    fact: {
      kind: "provider-operation",
      operationId,
      operationKind: row.shape.operationKind,
      target: materializeTarget(target, copyReference),
      resultCarrier,
      ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
      isAsync: false,
      isFallible: row.fallible === true,
      ...(row.shape.resultConversion === undefined ? {} : { resultConversion: row.shape.resultConversion }),
    },
    resultCarrier,
    ...(selectedParameterCarriers === undefined ? {} : { parameterCarriers: selectedParameterCarriers }),
    ...(callback === undefined ? {} : { callback }),
  };
}

function carrierRequirementsMatch(
  requirements: JsOperationRowData["requirements"],
  bindings: JsLaneBindings,
): boolean {
  return requirements?.every((requirement) => {
    const carrier = resolveCarrierRef(requirement.carrier, bindings);
    switch (requirement.capability) {
      case "numeric":
        return isRustNumericCarrier(carrier);
      case "integer":
        return isRustIntegerCarrier(carrier);
      case "clone":
        return rustCarrierSupportsClone(carrier);
      case "stringifiable":
        return isRustSourceStringConvertibleCarrier(carrier);
      case "js-equality":
        return rustCarrierSupportsJsEquality(carrier);
    }
  }) ?? true;
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
  if (expected.kind === "closure" && actual.kind === "closure") {
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

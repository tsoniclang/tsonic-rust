import {
  rustInt32ToFloat64ValueConversion,
} from "../../../../target-model/conversions/model.js";
import {
  rustJsValueTargetType,
  rustJsArrayConcatItemTargetType,
  rustJsArrayTargetType,
  rustJsArrayTargetId,
  rustSourcePrimitiveTargetType,
} from "../../../../target-model/types/index.js";
import { defineJsOperationRows } from "./model.js";
import { exactJsStringOperationRows } from "./exact-string-rows.js";
import { jsCapabilityOperationRows } from "./capability-rows.js";
import { regexpOperationRows } from "./regexp-rows.js";
import { bigintOperationRows } from "./bigint-rows.js";
import { stringConstructionRows } from "./string-construction-rows.js";
import type { JsOperationRowData } from "./model.js";
import type { RustCallbackOperationTemplate, RustProviderOperationForm, RustValueConversion } from "../../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

const zeroArgument = { kind: "integer", value: 0 } as const;
const dateZeroArgument = { kind: "float64", value: 0 } as const;
const dateOneArgument = { kind: "float64", value: 1 } as const;
export const rustInferCarrier: TargetTypeRef = { kind: "opaque", id: "tsonic.rust.infer" };
const jsNumberArgumentRows = [
  { variant: "float64", carrier: { ref: "float64" } as const, conversion: undefined },
  { variant: "int32", carrier: { ref: "int32" } as const, conversion: rustInt32ToFloat64ValueConversion },
] as const;
const nativeIndexArguments = [{ variant: "native", carrier: { ref: "numeric-argument", index: 0 } as const, conversion: undefined }] as const;
const nativeIndexPairs = [{ first: nativeIndexArguments[0], second: { variant: "native", carrier: { ref: "numeric-argument", index: 1 } as const, conversion: undefined } }] as const;

function nativeNumberPredicateRows(owner: "NumberConstructor" | "Global", lane: "number" | "global"): readonly JsOperationRowData[] {
  return numberPredicateRows.filter(({ member }) => owner === "NumberConstructor" || member === "isNaN" || member === "isFinite")
    .flatMap(({ member, path }): JsOperationRowData[] => [
      {
        owner, member, operationKind: "call", lane, variant: "native",
        requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "numeric" }],
        shape: {
          op: "operation", operationKind: "method", target: { form: "call", path },
          result: { ref: "bool" }, params: [{ ref: "argument", index: 0 }],
        },
      },
      {
        owner, member, operationKind: "call", lane, variant: "bigint",
        shape: {
          op: "operation", operationKind: "method", target: { form: "call", path, argModes: ["ref"] },
          result: { ref: "bool" }, params: [{ ref: "bigint" }],
        },
      },
    ]);
}

interface JsNumberArgumentCombination {
  readonly variant: string;
  readonly carriers: readonly ({ readonly ref: "float64" } | { readonly ref: "int32" })[];
  readonly conversions: readonly (RustValueConversion | undefined)[];
}

function jsNumberArgumentCombinations(count: number): readonly JsNumberArgumentCombination[] {
  let combinations: readonly JsNumberArgumentCombination[] = [{
    variant: "",
    carriers: [],
    conversions: [],
  }];
  for (let index = 0; index < count; index += 1) {
    combinations = combinations.flatMap((combination) =>
      jsNumberArgumentRows.map(({ variant, carrier, conversion }) => ({
        variant: combination.variant.length === 0 ? variant : `${combination.variant}-${variant}`,
        carriers: [...combination.carriers, carrier],
        conversions: [...combination.conversions, conversion],
      })));
  }
  return combinations;
}

function dateReceiverNumberRows(
  member: string,
  targetsByArity: readonly string[],
): readonly JsOperationRowData[] {
  return targetsByArity.flatMap((target, targetIndex) => {
    const arity = targetIndex + 1;
    return jsNumberArgumentCombinations(arity).map(({ variant, carriers, conversions }) => ({
      owner: "Date",
      member,
      operationKind: "call" as const,
      lane: "date" as const,
      variant,
      shape: {
        op: "operation" as const,
        operationKind: "method" as const,
        target: {
          form: "receiver-method" as const,
          name: target,
          argConversions: conversions,
        },
        result: { ref: "float64" as const },
        params: carriers,
      },
    }));
  });
}

function dateUtcRows(): readonly JsOperationRowData[] {
  const defaults = [
    dateOneArgument,
    dateZeroArgument,
    dateZeroArgument,
    dateZeroArgument,
    dateZeroArgument,
  ] as const;
  return [2, 3, 4, 5, 6, 7].flatMap((arity) =>
    jsNumberArgumentCombinations(arity).map(({ variant, carriers, conversions }) => ({
      owner: "DateConstructor",
      member: "UTC",
      operationKind: "call" as const,
      lane: "date" as const,
      variant,
      shape: {
        op: "operation" as const,
        operationKind: "method" as const,
        target: {
          form: "call" as const,
          path: "js_abi::JsDate::utc",
          argConversions: conversions,
          trailingArguments: defaults.slice(arity - 2),
        },
        result: { ref: "float64" as const },
        params: carriers,
      },
    })));
}
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
const arrayComparatorRows = [
  { arity: 0, variant: "zero", targetName: "sort_zero" },
  { arity: 1, variant: "value", targetName: "sort_value" },
  { arity: 2, variant: "left-right", targetName: "sort" },
] as const;
const arrayPredicateRows = [
  { member: "filter", targetName: "filter", result: { ref: "receiver" } as const },
  { member: "find", targetName: "find", result: { ref: "option-of-element" } as const },
  { member: "findIndex", targetName: "find_index", result: { ref: "native-int" } as const },
  { member: "findLast", targetName: "find_last", result: { ref: "option-of-element" } as const },
  { member: "findLastIndex", targetName: "find_last_index", result: { ref: "native-int" } as const },
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
    failure: {
      kind: "invocation",
      fallibleTarget: {
        form: "receiver-method",
        name: `try_${targetName}`,
        ...targetOptions,
      },
    },
  };
}

function staticCallbackOperation(
  sourceArgumentIndex: number,
  falliblePath: string,
): RustCallbackOperationTemplate {
  return {
    shape: "map",
    sourceArgumentIndex,
    failure: {
      kind: "invocation",
      fallibleTarget: {
        form: "call",
        path: falliblePath,
        argModes: ["ref", "value"],
      },
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
  { owner, member: "length", operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len", emptyTestMethod: "is_empty" }, evaluation: "pure", result: { ref: "native-uint" } } },
  { owner, member: "at", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "at", argModes: ["value"] }, result: { ref: "option-of-element" }, sourceResult: { ref: "element" }, sourceAbsence: "undefined", params: [{ ref: "numeric-argument", index: 0 }] } },
  { owner, member: "includes", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes_from_start", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "element" }] } },
  { owner, member: "includes", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes", argModes: ["ref", "value"] }, result: { ref: "bool" }, params: [{ ref: "element" }, { ref: "numeric-argument", index: 1 }] } },
  { owner, member: "indexOf", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of_from_start", argModes: ["ref"] }, result: { ref: "native-int" }, params: [{ ref: "element" }] } },
  { owner, member: "indexOf", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of", argModes: ["ref", "value"] }, result: { ref: "native-int" }, params: [{ ref: "element" }, { ref: "numeric-argument", index: 1 }] } },
  { owner, member: "lastIndexOf", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "last_index_of_from_end", argModes: ["ref"] }, result: { ref: "native-int" }, params: [{ ref: "element" }] } },
  { owner, member: "lastIndexOf", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "last_index_of", argModes: ["ref", "value"] }, result: { ref: "native-int" }, params: [{ ref: "element" }, { ref: "numeric-argument", index: 1 }] } },
  { owner, member: "index", operationKind: "indexer", lane: "js-array", variant: "native", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get_number", argModes: ["value"] }, borrowedIndexMethod: "borrow_number_element", ...(owner === "Array" ? { indexedLocationMethod: "element_location" } : {}), evaluation: "pure", result: { ref: "option-of-element" }, sourceResult: { ref: "element" }, sourceAbsence: "undefined", params: [{ ref: "numeric-argument", index: 0 }] } },
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
        ...(predicateRow.result.ref === "option-of-element"
          ? { sourceResult: { ref: "element" as const }, sourceAbsence: "undefined" as const }
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
  { owner, member: "slice", operationKind: "call", lane: "js-array", variant: "start", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_from" }, result: { ref: "element-array" }, params: [{ ref: "numeric-argument", index: 0 }] } },
  { owner, member: "slice", operationKind: "call", lane: "js-array", variant: "start-end", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "slice_to" }, result: { ref: "element-array" }, params: [{ ref: "numeric-argument", index: 0 }, { ref: "numeric-argument", index: 1 }] } },
  { owner, member: "concat", operationKind: "call", lane: "js-array", variadic: true, requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-tagged-array", name: "concat", receiverMode: "ref", leadingArguments: [], elementCarrier: rustJsArrayConcatItemTargetType(rustInferCarrier), alternatives: [{ inputCarrier: rustInferCarrier, mode: "value", constructorPath: "js_abi::JsArrayConcatItem::Value" }, { inputCarrier: rustJsArrayTargetType(rustInferCarrier), mode: "value", constructorPath: "js_abi::JsArrayConcatItem::Array" }] }, result: { ref: "element-array" } } },
  { owner, member: "join", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "stringifiable" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "join_default" }, result: { ref: "string" } } },
  { owner, member: "join", operationKind: "call", lane: "js-array", variant: "separator", requirements: [{ carrier: { ref: "element" }, capability: "stringifiable" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "join", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
]);

export const jsOperationRows = defineJsOperationRows([
  ...jsCapabilityOperationRows,
  ...stringConstructionRows,
  { owner: "ObjectConstructor", member: "keys", operationKind: "call", lane: "object", firstArgCarrierId: rustJsArrayTargetId, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsArray::object_keys", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "argument", index: 0 }] } },
  { owner: "ObjectConstructor", member: "is", operationKind: "call", lane: "object", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-array", path: "js_abi::object_is", leadingArguments: [], elementCarrier: rustJsValueTargetType() }, result: { ref: "bool" } } },
  { owner: "ObjectConstructor", member: "freeze", operationKind: "call", lane: "object", requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "freezable-object" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "tsonic_rust_runtime::freeze_object", argModes: ["ref"] }, result: { ref: "argument", index: 0 }, params: [{ ref: "argument", index: 0 }] } },
  { owner: "ObjectConstructor", member: "isFrozen", operationKind: "call", lane: "object", requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "object-identity" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "tsonic_rust_runtime::object_is_frozen", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "argument", index: 0 }] } },
  ...sharedArrayOperationRows,
  { owner: "ArrayConstructor", member: "isArray", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::array_is_array_value", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "jsvalue" }] } },
  { owner: "ArrayConstructor", member: "from", operationKind: "call", lane: "js-array", variant: "string", requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::array_from_string", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "string" }] } },
  { owner: "ArrayConstructor", member: "from", operationKind: "call", lane: "js-array", variant: "native-array", selectedMethodTypeArgumentArity: 1, requirements: [{ carrier: { ref: "selected-method-type-argument", index: 0 }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::array_from_vec", argModes: ["ref"] }, result: { ref: "selected-method-output-array", index: 0 }, params: [{ ref: "selected-method-input-array", index: 0 }] } },
  {
    owner: "ArrayConstructor", member: "from", operationKind: "call", lane: "js-array",
    variant: "js-array", firstArgCarrierId: rustJsArrayTargetId, selectedMethodTypeArgumentArity: 1,
    requirements: [{ carrier: { ref: "selected-method-type-argument", index: 0 }, capability: "clone" }],
    shape: { op: "operation", operationKind: "method",
      target: { form: "call", path: "js_abi::array_from_dense_array", argModes: ["ref"] },
      result: { ref: "selected-method-output-array", index: 0 },
      params: [{ ref: "selected-method-output-array", index: 0 }],
    },
  },
  ...([
    { arity: 0, variant: "zero", target: "array_from_string_map_zero", fallibleTarget: "array_from_string_try_map_zero" },
    { arity: 1, variant: "value", target: "array_from_string_map", fallibleTarget: "array_from_string_try_map" },
    { arity: 2, variant: "value-index", target: "array_from_string_map_with_index", fallibleTarget: "array_from_string_try_map_with_index" },
  ] as const).map(({ arity, variant, target, fallibleTarget }): JsOperationRowData => ({
    owner: "ArrayConstructor",
    member: "from",
    operationKind: "call",
    lane: "js-array",
    variant: `string-map-${variant}`,
    selectedMethodTypeArgumentArity: 2,
    callback: staticCallbackOperation(1, `js_abi::${fallibleTarget}`),
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "call", path: `js_abi::${target}`, argModes: ["ref", "value"] },
      result: { ref: "selected-method-output-array", index: 1 },
      params: [{ ref: "string" }, { ref: "cb-array-from-map", arity }],
    },
  })),
  ...([
    { arity: 0, variant: "zero", target: "array_from_vec_map_zero", fallibleTarget: "array_from_vec_try_map_zero" },
    { arity: 1, variant: "value", target: "array_from_vec_map", fallibleTarget: "array_from_vec_try_map" },
    { arity: 2, variant: "value-index", target: "array_from_vec_map_with_index", fallibleTarget: "array_from_vec_try_map_with_index" },
  ] as const).map(({ arity, variant, target, fallibleTarget }): JsOperationRowData => ({
    owner: "ArrayConstructor",
    member: "from",
    operationKind: "call",
    lane: "js-array",
    variant: `native-array-map-${variant}`,
    selectedMethodTypeArgumentArity: 2,
    requirements: [{ carrier: { ref: "selected-method-type-argument", index: 0 }, capability: "clone" }],
    callback: staticCallbackOperation(1, `js_abi::${fallibleTarget}`),
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "call", path: `js_abi::${target}`, argModes: ["ref", "value"] },
      result: { ref: "selected-method-output-array", index: 1 },
      params: [
        { ref: "selected-method-input-array", index: 0 },
        { ref: "cb-array-from-map", arity },
      ],
    },
  })),
  { owner: "ArrayConstructor", member: "of", operationKind: "call", lane: "js-array", selectedMethodTypeArgumentArity: 1, variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-array", path: "js_abi::array_of", leadingArguments: [], elementCarrier: rustInferCarrier }, result: { ref: "element-array" } } },
  { owner: "Array", member: "length", operationKind: "property-set", lane: "js-array", shape: { op: "set", target: { form: "receiver-method", name: "set_len" }, params: [{ ref: "numeric-argument", index: 0 }] } },
  ...["Array", "ReadonlyArray"].map(owner => ({ owner, member: "entries", operationKind: "call", lane: "js-array", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "entries" }, result: { ref: "array-entries" }, params: [] } } satisfies JsOperationRowData)),
  { owner: "ArrayEntriesIterator", member: "next", operationKind: "call", lane: "array-entries", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "next_result" }, result: { ref: "array-entry-result" }, params: [] } },
  { owner: "Array", member: "push", operationKind: "call", lane: "js-array", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "push_many", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, discardedTarget: { form: "receiver-value-array", name: "push_many_discard", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, result: { ref: "native-uint" } } },
  { owner: "Array", member: "pop", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "pop" }, result: { ref: "option-of-element" }, sourceResult: { ref: "element" }, sourceAbsence: "undefined" } },
  { owner: "Array", member: "shift", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "shift" }, result: { ref: "option-of-element" }, sourceResult: { ref: "element" }, sourceAbsence: "undefined" } },
  { owner: "Array", member: "unshift", operationKind: "call", lane: "js-array", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "unshift_many", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, discardedTarget: { form: "receiver-value-array", name: "unshift_many_discard", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, result: { ref: "native-uint" } } },
  { owner: "Array", member: "splice", operationKind: "call", lane: "js-array", variant: "start", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "splice_from" }, result: { ref: "element-array" }, params: [{ ref: "numeric-argument", index: 0 }] } },
  { owner: "Array", member: "splice", operationKind: "call", lane: "js-array", variant: "delete-and-items", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "splice_many", receiverMode: "ref", leadingArguments: [{ carrier: rustInferCarrier, mode: "value" }, { carrier: rustInferCarrier, mode: "value" }], elementCarrier: rustInferCarrier }, result: { ref: "element-array" }, params: [{ ref: "numeric-argument", index: 0 }, { ref: "numeric-argument", index: 1 }] } },
  { owner: "Array", member: "reverse", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "reverse" }, result: { ref: "receiver" } } },
  { owner: "Array", member: "sort", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "stringifiable" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "sort_by_js_string" }, result: { ref: "receiver" } } },
  ...arrayComparatorRows.map(({ arity, variant, targetName }): JsOperationRowData => ({
    owner: "Array",
    member: "sort",
    operationKind: "call",
    lane: "js-array",
    variant,
    callback: {
      ...callbackOperation("direct", targetName),
      ...(arity === 0 ? {} : { borrowedParameters: {
        target: { form: "receiver-method" as const, name: `${targetName}_borrowed` },
        fallibleTarget: { form: "receiver-method" as const, name: `try_${targetName}_borrowed` },
      } }),
    },
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "receiver-method", name: targetName },
      result: { ref: "receiver" },
      params: [{ ref: "cb-array-comparator", arity }],
    },
  })),
  { owner: "Array", member: "fill", operationKind: "call", lane: "js-array", variant: "all", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "fill_all" }, result: { ref: "receiver" }, params: [{ ref: "element" }] } },
  { owner: "Array", member: "fill", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "fill_from" }, result: { ref: "receiver" }, params: [{ ref: "element" }, { ref: "numeric-argument", index: 1 }] } },
  { owner: "Array", member: "fill", operationKind: "call", lane: "js-array", variant: "to", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "fill_to" }, result: { ref: "receiver" }, params: [{ ref: "element" }, { ref: "numeric-argument", index: 1 }, { ref: "numeric-argument", index: 2 }] } },
  { owner: "Array", member: "copyWithin", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "copy_within_from" }, result: { ref: "receiver" }, params: [{ ref: "numeric-argument", index: 0 }, { ref: "numeric-argument", index: 1 }] } },
  { owner: "Array", member: "copyWithin", operationKind: "call", lane: "js-array", variant: "to", requirements: [{ carrier: { ref: "element" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "copy_within_to" }, result: { ref: "receiver" }, params: [{ ref: "numeric-argument", index: 0 }, { ref: "numeric-argument", index: 1 }, { ref: "numeric-argument", index: 2 }] } },
  { owner: "Array", member: "index", operationKind: "index-set", lane: "js-array", variant: "native", shape: { op: "set", target: { form: "receiver-method", name: "set_number" }, params: [{ ref: "numeric-argument", index: 0 }, { ref: "element" }] } },
  { owner: "Array", member: "index", operationKind: "delete", lane: "js-array", variant: "native", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "delete_number" }, result: { ref: "bool" }, params: [{ ref: "numeric-argument", index: 0 }] } },
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
  { owner: "String", member: "length", operationKind: "property", lane: "string", shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_string::js_len", receiverMode: "ref" }, evaluation: "pure", result: { ref: "native-uint" } } },
  { owner: "String", member: "index", operationKind: "indexer", lane: "string", variant: "native", fallible: true, shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: "js_string::char_at", receiverMode: "ref", argModes: ["value"] }, evaluation: "pure", result: { ref: "string" }, params: [{ ref: "numeric-argument", index: 0 }] } },
  ...[
    { member: "includes", target: "includes", defaultTarget: "includes_from_start", result: { ref: "bool" } as const },
    { member: "startsWith", target: "starts_with", defaultTarget: "starts_with_from_start", result: { ref: "bool" } as const },
    { member: "endsWith", target: "ends_with", defaultTarget: "ends_with_at_end", result: { ref: "bool" } as const },
    { member: "indexOf", target: "index_of", defaultTarget: "index_of_from_start", result: { ref: "native-int" } as const },
    { member: "lastIndexOf", target: "last_index_of", defaultTarget: "last_index_of_from_end", result: { ref: "native-int" } as const },
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
        params: [{ ref: "string" }],
      },
    },
    ...nativeIndexArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({
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
        params: [{ ref: "string" }, { ...carrier, index: 1 }],
      },
    })),
  ]),
  { owner: "String", member: "toUpperCase", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_upper_case", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "toLowerCase", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_lower_case", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "normalize", operationKind: "call", lane: "string", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::normalize", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "normalize", operationKind: "call", lane: "string", variant: "form", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::normalize_with_form", receiverMode: "ref", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "isWellFormed", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::is_well_formed", receiverMode: "ref" }, result: { ref: "bool" } } },
  { owner: "String", member: "toWellFormed", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_well_formed", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "trim", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim", receiverMode: "ref" }, result: { ref: "string" } } },
  ...[{ member: "trimStart" }, { member: "trimLeft" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim_start", receiverMode: "ref" }, result: { ref: "string" } } })),
  ...[{ member: "trimEnd" }, { member: "trimRight" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim_end", receiverMode: "ref" }, result: { ref: "string" } } })),
  ...[{ member: "toString" }, { member: "valueOf" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::identity", receiverMode: "ref" }, result: { ref: "string" } } })),
  { owner: "String", member: "slice", operationKind: "call", lane: "string", variant: "default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice_from", receiverMode: "ref", trailingArguments: [zeroArgument] }, result: { ref: "string" } } },
  ...nativeIndexArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member: "slice", operationKind: "call", lane: "string", variant: `start-${variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice_from", receiverMode: "ref", argConversions: [conversion] }, result: { ref: "string" }, params: [carrier] } })),
  ...nativeIndexPairs.map(({ first, second }): JsOperationRowData => ({ owner: "String", member: "slice", operationKind: "call", lane: "string", variant: `start-${first.variant}-end-${second.variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice_to", receiverMode: "ref", argConversions: [first.conversion, second.conversion] }, result: { ref: "string" }, params: [first.carrier, second.carrier] } })),
  ...[{ member: "substring" }, { member: "substr" }].flatMap(({ member }): readonly JsOperationRowData[] => [
    ...nativeIndexArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", variant: `start-${variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${member}_from`, receiverMode: "ref", argConversions: [conversion] }, result: { ref: "string" }, params: [carrier] } })),
    ...nativeIndexPairs.map(({ first, second }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", variant: `start-${first.variant}-end-${second.variant}`, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${member}`, receiverMode: "ref", argConversions: [first.conversion, second.conversion] }, result: { ref: "string" }, params: [first.carrier, second.carrier] } })),
  ]),
  ...[
    { member: "charAt", target: "char_at", result: { ref: "string" } as const, fallible: true },
    { member: "charCodeAt", target: "char_code_at", result: { ref: "float64" } as const, fallible: false },
    { member: "codePointAt", target: "code_point_at", result: { ref: "option-of-uint32" } as const, fallible: false },
    { member: "at", target: "at", result: { ref: "option-of-string" } as const, fallible: true },
    { member: "repeat", target: "repeat", result: { ref: "string" } as const, fallible: true },
  ].flatMap((row) => nativeIndexArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member: row.member, operationKind: "call", lane: "string", variant, ...(row.fallible ? { fallible: true } : {}), shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${row.target}`, receiverMode: "ref", argConversions: [conversion] }, result: row.result, params: [carrier] } }))),
  { owner: "String", member: "split", operationKind: "call", lane: "string", variant: "string-default", fallible: true, shape: { op: "operation", evaluation: "pure", operationKind: "method", target: { form: "free-call", path: "js_string::split_all", receiverMode: "ref", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "string" }] } },
  ...nativeIndexArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member: "split", operationKind: "call", lane: "string", variant: `string-limit-${variant}`, fallible: true, shape: { op: "operation", evaluation: "pure", operationKind: "method", target: { form: "free-call", path: "js_string::split", receiverMode: "ref", argModes: ["ref", "value"], argConversions: [undefined, conversion] }, result: { ref: "string-array" }, params: [{ ref: "string" }, { ...carrier, index: 1 }] } })),
  { owner: "String", member: "concat", operationKind: "call", lane: "string", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call-str-slice", path: "js_string::concat", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "StringConstructor", member: "fromCharCode", operationKind: "call", lane: "string", variadic: true, numericRest: true, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_string::from_char_code", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "string" } } },
  { owner: "StringConstructor", member: "fromCodePoint", operationKind: "call", lane: "string", variadic: true, numericRest: true, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_string::from_code_point", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "string" } } },

  // Map lane.
  ...(["Map", "ReadonlyMap"] as const).flatMap((owner): readonly JsOperationRowData[] => [
    { owner, member: "get", operationKind: "call", lane: "map", variant: "same-value-zero", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }, { carrier: { ref: "map-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get", argModes: ["ref"] }, result: { ref: "option-of-map-value" }, sourceResult: { ref: "map-value" }, sourceAbsence: "undefined", params: [{ ref: "map-key" }] } },
    { owner, member: "get", operationKind: "call", lane: "map", variant: "project-identity", requirements: [{ carrier: { ref: "map-key" }, capability: "project-identity-equality" }, { carrier: { ref: "map-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_eq", argModes: ["ref"] }, result: { ref: "option-of-map-value" }, sourceResult: { ref: "map-value" }, sourceAbsence: "undefined", params: [{ ref: "map-key" }] } },
    { owner, member: "has", operationKind: "call", lane: "map", variant: "same-value-zero", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
    { owner, member: "has", operationKind: "call", lane: "map", variant: "project-identity", requirements: [{ carrier: { ref: "map-key" }, capability: "project-identity-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has_eq", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
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
    { owner, member: "size", operationKind: "property", lane: "map", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len", emptyTestMethod: "is_empty" }, evaluation: "pure", result: { ref: "native-uint" } } },
  ]),
  { owner: "Map", member: "set", operationKind: "call", lane: "map", variant: "same-value-zero", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "set" }, discardedTarget: { form: "receiver-method", name: "set_discard" }, result: { ref: "receiver" }, params: [{ ref: "map-key" }, { ref: "map-value" }] } },
  { owner: "Map", member: "set", operationKind: "call", lane: "map", variant: "project-identity", requirements: [{ carrier: { ref: "map-key" }, capability: "project-identity-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "set_eq" }, discardedTarget: { form: "receiver-method", name: "set_eq_discard" }, result: { ref: "receiver" }, params: [{ ref: "map-key" }, { ref: "map-value" }] } },
  { owner: "Map", member: "delete", operationKind: "call", lane: "map", variant: "same-value-zero", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "delete", operationKind: "call", lane: "map", variant: "project-identity", requirements: [{ carrier: { ref: "map-key" }, capability: "project-identity-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete_eq", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "map-key" }] } },
  { owner: "Map", member: "clear", operationKind: "call", lane: "map", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "clear" }, result: { ref: "unit" } } },

  // Set lane.
  ...(["Set", "ReadonlySet"] as const).flatMap((owner): readonly JsOperationRowData[] => [
    { owner, member: "has", operationKind: "call", lane: "set", variant: "same-value-zero", requirements: [{ carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
    { owner, member: "has", operationKind: "call", lane: "set", variant: "project-identity", requirements: [{ carrier: { ref: "set-value" }, capability: "project-identity-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "has_eq", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
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
    { owner, member: "size", operationKind: "property", lane: "set", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len", emptyTestMethod: "is_empty" }, evaluation: "pure", result: { ref: "native-uint" } } },
  ]),
  { owner: "Set", member: "add", operationKind: "call", lane: "set", variant: "same-value-zero", requirements: [{ carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "add" }, discardedTarget: { form: "receiver-method", name: "add_discard" }, result: { ref: "receiver" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "add", operationKind: "call", lane: "set", variant: "project-identity", requirements: [{ carrier: { ref: "set-value" }, capability: "project-identity-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "add_eq" }, discardedTarget: { form: "receiver-method", name: "add_eq_discard" }, result: { ref: "receiver" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "delete", operationKind: "call", lane: "set", variant: "same-value-zero", requirements: [{ carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "delete", operationKind: "call", lane: "set", variant: "project-identity", requirements: [{ carrier: { ref: "set-value" }, capability: "project-identity-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete_eq", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "clear", operationKind: "call", lane: "set", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "clear" }, result: { ref: "unit" } } },

  // JSON lane (static owner; fallible rows require a fallible context).
  { owner: "JSON", member: "parse", operationKind: "call", lane: "json", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::json_parse", argModes: ["ref"] }, result: { ref: "jsvalue" }, params: [{ ref: "string" }] } },
  { owner: "JSON", member: "stringify", operationKind: "call", lane: "json", variant: "string-only", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::json_stringify_string", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
  { owner: "JSON", member: "stringify", operationKind: "call", lane: "json", variant: "value-only", fallible: true, jsonValueSourceArgumentIndexes: [0], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::json_stringify", argModes: ["ref"] }, result: { ref: "option-of-string" }, params: [{ ref: "jsvalue" }] } },

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

  ...exactJsStringOperationRows,
  ...regexpOperationRows,
  ...bigintOperationRows,
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "native-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start", receiverMode: "ref", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "numeric-argument", index: 0 }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "native-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start_with", receiverMode: "ref", argModes: ["value", "ref"] }, result: { ref: "string" }, params: [{ ref: "numeric-argument", index: 0 }, { ref: "string" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "native-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end", receiverMode: "ref", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "numeric-argument", index: 0 }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "native-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end_with", receiverMode: "ref", argModes: ["value", "ref"] }, result: { ref: "string" }, params: [{ ref: "numeric-argument", index: 0 }, { ref: "string" }] } },

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
  ...(["int8", "uint8", "int16", "uint16", "int32", "uint32", "native-int", "native-uint"] as const).map((carrier): JsOperationRowData => ({
    owner: "Math", member: "floor", operationKind: "call", lane: "math", variant: carrier,
    requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "integer" }],
    shape: { op: "operation", operationKind: "method", target: { form: "numeric-cast", target: carrier },
      result: { ref: carrier }, params: [{ ref: carrier }], evaluation: "pure" },
  })),
  { owner: "Math", member: "floor", operationKind: "call", lane: "math", variant: "floating", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "floor" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "ceil", operationKind: "call", lane: "math", shape: { op: "operation", operationKind: "method", target: { form: "arg-method", name: "ceil" }, result: { ref: "float64" }, params: [{ ref: "float64" }] } },
  { owner: "Math", member: "clz32", operationKind: "call", lane: "math", requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "numeric" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_clz32" }, result: { ref: "int32" }, params: [{ ref: "argument", index: 0 }] } },
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
  { owner: "Math", member: "imul", operationKind: "call", lane: "math", requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "numeric" }, { carrier: { ref: "argument", index: 1 }, capability: "numeric" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::math_imul" }, result: { ref: "int32" }, params: [{ ref: "argument", index: 0 }, { ref: "argument", index: 1 }] } },
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

  ...nativeNumberPredicateRows("NumberConstructor", "number"),
  { owner: "NumberConstructor", member: "parseFloat", operationKind: "call", lane: "number", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_float", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "NumberConstructor", member: "parseInt", operationKind: "call", lane: "number", variant: "default", shape: { op: "operation", evaluation: "pure", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "NumberConstructor", member: "parseInt", operationKind: "call", lane: "number", variant: "float64-radix", shape: { op: "operation", evaluation: "pure", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int_radix", argModes: ["ref", "value"] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "float64" }] } },
  { owner: "NumberConstructor", member: "parseInt", operationKind: "call", lane: "number", variant: "int32-radix", shape: { op: "operation", evaluation: "pure", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int_radix", argModes: ["ref", "value"], argConversions: [undefined, rustInt32ToFloat64ValueConversion] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "int32" }] } },
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
  { owner: "Global", member: "parseInt", operationKind: "call", lane: "global", variant: "default", shape: { op: "operation", evaluation: "pure", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: "Global", member: "parseInt", operationKind: "call", lane: "global", variant: "float64-radix", shape: { op: "operation", evaluation: "pure", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int_radix", argModes: ["ref", "value"] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "float64" }] } },
  { owner: "Global", member: "parseInt", operationKind: "call", lane: "global", variant: "int32-radix", shape: { op: "operation", evaluation: "pure", operationKind: "method", target: { form: "call", path: "js_abi::number_parse_int_radix", argModes: ["ref", "value"], argConversions: [undefined, rustInt32ToFloat64ValueConversion] }, result: { ref: "float64" }, params: [{ ref: "string" }, { ref: "int32" }] } },
  { owner: "Global", member: "encodeURIComponent", operationKind: "call", lane: "global", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::encode_uri_component", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
  { owner: "Global", member: "decodeURIComponent", operationKind: "call", lane: "global", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::decode_uri_component", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
  ...nativeNumberPredicateRows("Global", "global"),

  { owner: "Boolean", member: "toString", operationKind: "call", lane: "boolean", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::boolean_to_string", receiverMode: "value" }, result: { ref: "string" } } },
  { owner: "Boolean", member: "valueOf", operationKind: "call", lane: "boolean", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::boolean_value_of", receiverMode: "value" }, result: { ref: "bool" } } },

  // Date lane.
  { owner: "DateConstructor", member: "parse", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::parse", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  ...dateUtcRows(),
  { owner: "Date", member: "toJSON", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_json" }, result: { ref: "option-of-string" }, sourceResult: { ref: "string" }, sourceAbsence: "null" } },
  { owner: "Date", member: "valueOf", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_time" }, result: { ref: "float64" } } },
  { owner: "DateConstructor", member: "now", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::now" }, result: { ref: "float64" } } },
  { owner: "Date", member: "toISOString", operationKind: "call", lane: "date", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_iso_string" }, result: { ref: "string" } } },
  { owner: "Date", member: "toUTCString", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_utc_string" }, result: { ref: "string" } } },
  { owner: "Date", member: "getTime", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_time" }, result: { ref: "float64" } } },
  ...([
    ["getUTCFullYear", "get_utc_full_year_number"],
    ["getUTCMonth", "get_utc_month_number"],
    ["getUTCDate", "get_utc_date_number"],
    ["getUTCDay", "get_utc_day_number"],
    ["getUTCHours", "get_utc_hours_number"],
    ["getUTCMinutes", "get_utc_minutes_number"],
    ["getUTCSeconds", "get_utc_seconds_number"],
    ["getUTCMilliseconds", "get_utc_milliseconds_number"],
    ["getMilliseconds", "get_milliseconds"],
  ] as const).map(([member, name]): JsOperationRowData => ({ owner: "Date", member, operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name }, result: { ref: "float64" } } })),
  ...([
    ["getFullYear", "get_full_year"],
    ["getMonth", "get_month"],
    ["getDate", "get_date"],
    ["getDay", "get_day"],
    ["getHours", "get_hours"],
    ["getMinutes", "get_minutes"],
    ["getSeconds", "get_seconds"],
    ["getTimezoneOffset", "get_timezone_offset"],
  ] as const).map(([member, name]): JsOperationRowData => ({ owner: "Date", member, operationKind: "call", lane: "date", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name }, result: { ref: "float64" } } })),
  ...dateReceiverNumberRows("setTime", ["set_time"]),
  ...dateReceiverNumberRows("setUTCMilliseconds", ["set_utc_milliseconds"]),
  ...dateReceiverNumberRows("setUTCSeconds", ["set_utc_seconds", "set_utc_seconds_milliseconds"]),
  ...dateReceiverNumberRows("setUTCMinutes", ["set_utc_minutes", "set_utc_minutes_seconds", "set_utc_minutes_seconds_milliseconds"]),
  ...dateReceiverNumberRows("setUTCHours", ["set_utc_hours", "set_utc_hours_minutes", "set_utc_hours_minutes_seconds", "set_utc_hours_minutes_seconds_milliseconds"]),
  ...dateReceiverNumberRows("setUTCDate", ["set_utc_date"]),
  ...dateReceiverNumberRows("setUTCMonth", ["set_utc_month", "set_utc_month_date"]),
  ...dateReceiverNumberRows("setUTCFullYear", ["set_utc_full_year", "set_utc_full_year_month", "set_utc_full_year_month_date"]),
]);

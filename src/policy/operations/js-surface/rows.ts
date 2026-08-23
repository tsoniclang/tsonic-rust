import {
  rustInt32ToFloat64ValueConversion,
  rustInt32ToUsizeValueConversion,
  rustIsizeToFloat64ValueConversion,
  rustIsizeToInt32ValueConversion,
  rustUsizeToInt32ValueConversion,
} from "../../../target-model/conversions/model.js";
import {
  rustJsValueTargetType,
  rustJsArrayConcatItemTargetType,
  rustJsArrayTargetType,
  rustJsStringTargetType,
  rustSourcePrimitiveTargetType,
} from "../../../target-model/types/index.js";
import { defineJsOperationRows } from "./model.js";
import type { JsOperationRowData } from "./model.js";
import type { RustCallbackOperationTemplate, RustProviderOperationForm, RustValueConversion } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";

const zeroArgument = { kind: "integer", value: 0 } as const;
const oneArgument = { kind: "integer", value: 1 } as const;
const noneArgument = { kind: "none" } as const;
const regexpOwner = jsRegExpSourceProfileIdentity.owners.regExp;
const regexpConstructorOwner = jsRegExpSourceProfileIdentity.owners.regExpConstructor;
const regexpExecArrayOwner = jsRegExpSourceProfileIdentity.owners.regExpExecArray;
const regexpIndicesArrayOwner = jsRegExpSourceProfileIdentity.owners.regExpIndicesArray;
const regexpMatchArrayOwner = jsRegExpSourceProfileIdentity.owners.regExpMatchArray;
const regexpNamedGroupsOwner = jsRegExpSourceProfileIdentity.owners.regExpNamedGroups;
const regexpNamedIndicesOwner = jsRegExpSourceProfileIdentity.owners.regExpNamedIndices;
const regexpStringIteratorOwner = jsRegExpSourceProfileIdentity.owners.regExpStringIterator;
const regexpMembers = jsRegExpSourceProfileIdentity.regExpMembers;
const regexpConstructorMembers = jsRegExpSourceProfileIdentity.regExpConstructorMembers;
const regexpResultMembers = jsRegExpSourceProfileIdentity.regExpResultMembers;
const regexpStringMembers = jsRegExpSourceProfileIdentity.stringMembers;
const regexpWellKnownMembers = jsRegExpSourceProfileIdentity.wellKnownMemberKeys;
const stringOwner = jsRegExpSourceProfileIdentity.owners.string;
export const rustInferCarrier: TargetTypeRef = { kind: "opaque", id: "tsonic.rust.infer" };
const jsNumberArgumentRows = [
  { variant: "float64", carrier: { ref: "float64" } as const, conversion: undefined },
  { variant: "int32", carrier: { ref: "int32" } as const, conversion: rustInt32ToFloat64ValueConversion },
] as const;
const jsNumberArgumentPairs = jsNumberArgumentRows.flatMap((first) =>
  jsNumberArgumentRows.map((second) => ({ first, second }))
);

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
  const defaults = [oneArgument, zeroArgument, zeroArgument, zeroArgument, zeroArgument] as const;
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

function staticCallbackOperation(
  sourceArgumentIndex: number,
  falliblePath: string,
): RustCallbackOperationTemplate {
  return {
    shape: "map",
    sourceArgumentIndex,
    fallibleTarget: {
      form: "call",
      path: falliblePath,
      argModes: ["ref", "value"],
    },
  };
}

function regexpReplacementCallbackOperation(
  fallibleTarget: RustProviderOperationForm,
): RustCallbackOperationTemplate {
  return {
    shape: "direct",
    sourceArgumentIndex: 1,
    argumentAdapter: "js-regexp-replacement",
    fallibleTarget,
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
  { owner, member: "length", operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, resultConversion: rustUsizeToInt32ValueConversion, evaluation: "pure", result: { ref: "int32" } } },
  { owner, member: "at", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "at", argModes: ["value"] }, result: { ref: "option-of-element" }, params: [{ ref: "float64" }] } },
  { owner, member: "includes", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes_from_start", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "element" }] } },
  { owner, member: "includes", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "includes", argModes: ["ref", "value"] }, result: { ref: "bool" }, params: [{ ref: "element" }, { ref: "float64" }] } },
  { owner, member: "indexOf", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of_from_start", argModes: ["ref"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner, member: "indexOf", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "index_of", argModes: ["ref", "value"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }, { ref: "float64" }] } },
  { owner, member: "lastIndexOf", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "last_index_of_from_end", argModes: ["ref"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }] } },
  { owner, member: "lastIndexOf", operationKind: "call", lane: "js-array", variant: "from", requirements: [{ carrier: { ref: "element" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "last_index_of", argModes: ["ref", "value"] }, resultConversion: rustIsizeToInt32ValueConversion, result: { ref: "int32" }, params: [{ ref: "element" }, { ref: "float64" }] } },
  { owner, member: "index", operationKind: "indexer", lane: "js-array", variant: "number", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get_number", argModes: ["value"] }, evaluation: "pure", result: { ref: "option-of-element" }, sourceResult: { ref: "element" }, sourceAbsence: "undefined", params: [{ ref: "float64" }] } },
  { owner, member: "index", operationKind: "indexer", lane: "js-array", variant: "int32", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get_number", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, evaluation: "pure", result: { ref: "option-of-element" }, sourceResult: { ref: "element" }, sourceAbsence: "undefined", params: [{ ref: "int32" }] } },
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

export const jsOperationRows = defineJsOperationRows([
  { owner: "ObjectConstructor", member: "is", operationKind: "call", lane: "object", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-array", path: "js_abi::object_is", leadingArguments: [], elementCarrier: rustJsValueTargetType() }, result: { ref: "bool" } } },
  ...sharedArrayOperationRows,
  { owner: "ArrayConstructor", member: "isArray", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::array_is_array_value", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "jsvalue" }] } },
  { owner: "ArrayConstructor", member: "from", operationKind: "call", lane: "js-array", variant: "string", requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::array_from_string", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "string" }] } },
  { owner: "ArrayConstructor", member: "from", operationKind: "call", lane: "js-array", variant: "native-array", selectedMethodTypeArgumentArity: 1, requirements: [{ carrier: { ref: "selected-method-type-argument", index: 0 }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::array_from_vec", argModes: ["ref"] }, result: { ref: "selected-method-output-array", index: 0 }, params: [{ ref: "selected-method-input-array", index: 0 }] } },
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
  { owner: "Array", member: "length", operationKind: "property-set", lane: "js-array", shape: { op: "set", target: { form: "receiver-method", name: "set_len", argConversions: [rustInt32ToUsizeValueConversion] }, params: [{ ref: "int32" }] } },
  { owner: "Array", member: "push", operationKind: "call", lane: "js-array", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "push_many", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, discardedTarget: { form: "receiver-value-array", name: "push_many_discard", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  { owner: "Array", member: "pop", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "pop" }, result: { ref: "option-of-element" } } },
  { owner: "Array", member: "shift", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "shift" }, result: { ref: "option-of-element" } } },
  { owner: "Array", member: "unshift", operationKind: "call", lane: "js-array", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "unshift_many", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, discardedTarget: { form: "receiver-value-array", name: "unshift_many_discard", receiverMode: "ref", leadingArguments: [], elementCarrier: rustInferCarrier }, resultConversion: rustUsizeToInt32ValueConversion, result: { ref: "int32" } } },
  { owner: "Array", member: "splice", operationKind: "call", lane: "js-array", variant: "start", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "splice_from" }, result: { ref: "element-array" }, params: [{ ref: "float64" }] } },
  { owner: "Array", member: "splice", operationKind: "call", lane: "js-array", variant: "delete-and-items", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-value-array", name: "splice_many", receiverMode: "ref", leadingArguments: [{ carrier: rustSourcePrimitiveTargetType("float64"), mode: "value" }, { carrier: rustSourcePrimitiveTargetType("float64"), mode: "value" }], elementCarrier: rustInferCarrier }, result: { ref: "element-array" }, params: [{ ref: "float64" }, { ref: "float64" }] } },
  { owner: "Array", member: "reverse", operationKind: "call", lane: "js-array", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "reverse" }, result: { ref: "receiver" } } },
  { owner: "Array", member: "sort", operationKind: "call", lane: "js-array", variant: "default", requirements: [{ carrier: { ref: "element" }, capability: "stringifiable" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "sort_by_js_string" }, result: { ref: "receiver" } } },
  ...arrayComparatorRows.map(({ arity, variant, targetName }): JsOperationRowData => ({
    owner: "Array",
    member: "sort",
    operationKind: "call",
    lane: "js-array",
    variant,
    callback: callbackOperation("direct", targetName),
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "receiver-method", name: targetName },
      result: { ref: "receiver" },
      params: [{ ref: "cb-array-comparator", arity }],
    },
  })),
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
  { owner: "String", member: "length", operationKind: "property", lane: "string", shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_string::js_len", receiverMode: "ref" }, resultConversion: rustUsizeToInt32ValueConversion, evaluation: "pure", result: { ref: "int32" } } },
  { owner: "String", member: "index", operationKind: "indexer", lane: "string", variant: "number", fallible: false, shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: "js_string::char_at", receiverMode: "ref", argModes: ["value"] }, evaluation: "pure", result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "index", operationKind: "indexer", lane: "string", variant: "int32", fallible: false, shape: { op: "operation", operationKind: "indexer", target: { form: "free-call", path: "js_string::char_at", receiverMode: "ref", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, evaluation: "pure", result: { ref: "string" }, params: [{ ref: "int32" }] } },
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
  { owner: "String", member: "normalize", operationKind: "call", lane: "string", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::normalize", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "normalize", operationKind: "call", lane: "string", variant: "form", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::normalize_with_form", receiverMode: "ref", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
  { owner: "String", member: "isWellFormed", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::is_well_formed", receiverMode: "ref" }, result: { ref: "bool" } } },
  { owner: "String", member: "toWellFormed", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::to_well_formed", receiverMode: "ref" }, result: { ref: "string" } } },
  { owner: "String", member: "trim", operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim", receiverMode: "ref" }, result: { ref: "string" } } },
  ...[{ member: "trimStart" }, { member: "trimLeft" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim_start", receiverMode: "ref" }, result: { ref: "string" } } })),
  ...[{ member: "trimEnd" }, { member: "trimRight" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::trim_end", receiverMode: "ref" }, result: { ref: "string" } } })),
  ...[{ member: "toString" }, { member: "valueOf" }].map(({ member }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::identity", receiverMode: "ref" }, result: { ref: "string" } } })),
  { owner: "String", member: "slice", operationKind: "call", lane: "string", variant: "default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice", receiverMode: "ref", trailingArguments: [zeroArgument, noneArgument] }, result: { ref: "string" } } },
  ...jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member: "slice", operationKind: "call", lane: "string", variant: `start-${variant}`, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice", receiverMode: "ref", argConversions: [conversion], trailingArguments: [noneArgument] }, result: { ref: "string" }, params: [carrier] } })),
  ...jsNumberArgumentPairs.map(({ first, second }): JsOperationRowData => ({ owner: "String", member: "slice", operationKind: "call", lane: "string", variant: `start-${first.variant}-end-${second.variant}`, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::slice_to", receiverMode: "ref", argConversions: [first.conversion, second.conversion] }, result: { ref: "string" }, params: [first.carrier, second.carrier] } })),
  ...[{ member: "substring" }, { member: "substr" }].flatMap(({ member }): readonly JsOperationRowData[] => [
    ...jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", variant: `start-${variant}`, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${member}_from`, receiverMode: "ref", argConversions: [conversion] }, result: { ref: "string" }, params: [carrier] } })),
    ...jsNumberArgumentPairs.map(({ first, second }): JsOperationRowData => ({ owner: "String", member, operationKind: "call", lane: "string", variant: `start-${first.variant}-end-${second.variant}`, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${member}`, receiverMode: "ref", argConversions: [first.conversion, second.conversion] }, result: { ref: "string" }, params: [first.carrier, second.carrier] } })),
  ]),
  ...[
    { member: "charAt", target: "char_at", result: { ref: "string" } as const, fallible: false },
    { member: "charCodeAt", target: "char_code_at", result: { ref: "float64" } as const, fallible: false },
    { member: "codePointAt", target: "code_point_at", result: { ref: "option-of-float64" } as const, fallible: false },
    { member: "at", target: "at", result: { ref: "option-of-string" } as const, fallible: false },
    { member: "repeat", target: "repeat", result: { ref: "string" } as const, fallible: true },
  ].flatMap((row) => jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: "String", member: row.member, operationKind: "call", lane: "string", variant, ...(row.fallible ? { fallible: true } : {}), shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: `js_string::${row.target}`, receiverMode: "ref", argConversions: [conversion] }, result: row.result, params: [carrier] } }))),
  { owner: stringOwner, member: regexpStringMembers.split, operationKind: "call", lane: "string", variant: "string-default", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::split_all", receiverMode: "ref", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "string" }] } },
  ...jsNumberArgumentRows.map(({ variant, carrier, conversion }): JsOperationRowData => ({ owner: stringOwner, member: regexpStringMembers.split, operationKind: "call", lane: "string", variant: `string-limit-${variant}`, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::split", receiverMode: "ref", argModes: ["ref", "value"], argConversions: [undefined, conversion] }, result: { ref: "string-array" }, params: [{ ref: "string" }, carrier] } })),
  { owner: stringOwner, member: regexpStringMembers.replace, operationKind: "call", lane: "string", variant: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::replace", receiverMode: "ref", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [{ ref: "string" }, { ref: "string" }] } },
  { owner: stringOwner, member: regexpStringMembers.replace, operationKind: "call", lane: "string", variant: "string-callback", callback: regexpReplacementCallbackOperation({ form: "free-call", path: "js_string::try_replace_with", receiverMode: "ref", argModes: ["ref", "value"] }), shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::replace_with", receiverMode: "ref", argModes: ["ref", "value"] }, result: { ref: "string" }, params: [{ ref: "string" }, { ref: "argument", index: 1 }] } },
  { owner: stringOwner, member: regexpStringMembers.replaceAll, operationKind: "call", lane: "string", variant: "string", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::replace_all", receiverMode: "ref", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [{ ref: "string" }, { ref: "string" }] } },
  { owner: stringOwner, member: regexpStringMembers.replaceAll, operationKind: "call", lane: "string", variant: "string-callback", callback: regexpReplacementCallbackOperation({ form: "free-call", path: "js_string::try_replace_all_with", receiverMode: "ref", argModes: ["ref", "value"] }), shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::replace_all_with", receiverMode: "ref", argModes: ["ref", "value"] }, result: { ref: "string" }, params: [{ ref: "string" }, { ref: "argument", index: 1 }] } },
  { owner: "String", member: "concat", operationKind: "call", lane: "string", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call-ref-slice", path: "js_string::concat", receiverMode: "ref", elementCarrier: rustJsStringTargetType() }, result: { ref: "string" } } },
  { owner: "StringConstructor", member: "fromCharCode", operationKind: "call", lane: "string", variadic: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_string::from_char_code", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "string" } } },
  { owner: "StringConstructor", member: "fromCodePoint", operationKind: "call", lane: "string", variadic: true, fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "call-value-slice", path: "js_string::from_code_point", leadingArguments: [], elementCarrier: rustSourcePrimitiveTargetType("float64") }, result: { ref: "string" } } },

  // Map lane.
  ...(["Map", "ReadonlyMap"] as const).flatMap((owner): readonly JsOperationRowData[] => [
    { owner, member: "get", operationKind: "call", lane: "map", variant: "same-value-zero", requirements: [{ carrier: { ref: "map-key" }, capability: "js-equality" }, { carrier: { ref: "map-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get", argModes: ["ref"] }, result: { ref: "option-of-map-value" }, params: [{ ref: "map-key" }] } },
    { owner, member: "get", operationKind: "call", lane: "map", variant: "project-identity", requirements: [{ carrier: { ref: "map-key" }, capability: "project-identity-equality" }, { carrier: { ref: "map-value" }, capability: "clone" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "get_eq", argModes: ["ref"] }, result: { ref: "option-of-map-value" }, params: [{ ref: "map-key" }] } },
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
    { owner, member: "size", operationKind: "property", lane: "map", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, resultConversion: rustUsizeToInt32ValueConversion, evaluation: "pure", result: { ref: "int32" } } },
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
    { owner, member: "size", operationKind: "property", lane: "set", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "len" }, resultConversion: rustUsizeToInt32ValueConversion, evaluation: "pure", result: { ref: "int32" } } },
  ]),
  { owner: "Set", member: "add", operationKind: "call", lane: "set", variant: "same-value-zero", requirements: [{ carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "add" }, discardedTarget: { form: "receiver-method", name: "add_discard" }, result: { ref: "receiver" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "add", operationKind: "call", lane: "set", variant: "project-identity", requirements: [{ carrier: { ref: "set-value" }, capability: "project-identity-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "add_eq" }, discardedTarget: { form: "receiver-method", name: "add_eq_discard" }, result: { ref: "receiver" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "delete", operationKind: "call", lane: "set", variant: "same-value-zero", requirements: [{ carrier: { ref: "set-value" }, capability: "js-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
  { owner: "Set", member: "delete", operationKind: "call", lane: "set", variant: "project-identity", requirements: [{ carrier: { ref: "set-value" }, capability: "project-identity-equality" }], shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "delete_eq", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "set-value" }] } },
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

  // RegExp result objects retain their exact declaration owners. Inherited
  // array members continue through the ordinary Array/ReadonlyArray rows.
  { owner: regexpExecArrayOwner, member: regexpResultMembers.first, operationKind: "indexer", lane: "js-array", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "required_group", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: regexpExecArrayOwner, member: regexpResultMembers.index, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "index" }, result: { ref: "float64" } } },
  { owner: regexpExecArrayOwner, member: regexpResultMembers.input, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "input" }, result: { ref: "string" } } },
  { owner: regexpExecArrayOwner, member: regexpResultMembers.groups, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "groups" }, result: { ref: "option-of-regexp-named-groups" }, sourceResult: { ref: "regexp-named-groups" }, sourceAbsence: "undefined" } },
  { owner: regexpExecArrayOwner, member: regexpResultMembers.indices, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "indices" }, result: { ref: "option-of-regexp-indices" }, sourceResult: { ref: "regexp-indices" }, sourceAbsence: "undefined" } },
  { owner: regexpMatchArrayOwner, member: regexpResultMembers.first, operationKind: "indexer", lane: "js-array", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "required_group", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: regexpMatchArrayOwner, member: regexpResultMembers.index, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "index" }, result: { ref: "option-of-float64" }, sourceResult: { ref: "float64" }, sourceAbsence: "undefined" } },
  { owner: regexpMatchArrayOwner, member: regexpResultMembers.input, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "input" }, result: { ref: "option-of-string" }, sourceResult: { ref: "string" }, sourceAbsence: "undefined" } },
  { owner: regexpMatchArrayOwner, member: regexpResultMembers.groups, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "groups" }, result: { ref: "option-of-regexp-named-groups" }, sourceResult: { ref: "regexp-named-groups" }, sourceAbsence: "undefined" } },
  { owner: regexpMatchArrayOwner, member: regexpResultMembers.indices, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "indices" }, result: { ref: "option-of-regexp-indices" }, sourceResult: { ref: "regexp-indices" }, sourceAbsence: "undefined" } },
  { owner: regexpIndicesArrayOwner, member: regexpResultMembers.groups, operationKind: "property", lane: "js-array", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "groups" }, result: { ref: "option-of-regexp-named-indices" }, sourceResult: { ref: "regexp-named-indices" }, sourceAbsence: "undefined" } },

  // Named groups are exact closed string-keyed result objects. Property access
  // supplies the authored key only after the selected index declaration proves
  // the operation identity; element access supplies the selected key value.
  { owner: regexpNamedGroupsOwner, member: "index", operationKind: "property", lane: "regexp-named-groups", authoredPropertyKey: true, shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_abi::regexp_named_groups_get", receiverMode: "ref" }, result: { ref: "option-of-string" }, sourceResult: { ref: "string" }, sourceAbsence: "undefined" } },
  { owner: regexpNamedGroupsOwner, member: "index", operationKind: "indexer", lane: "regexp-named-groups", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get", argModes: ["ref"] }, result: { ref: "option-of-string" }, sourceResult: { ref: "string" }, sourceAbsence: "undefined", params: [{ ref: "string" }] } },
  { owner: regexpNamedGroupsOwner, member: "index", operationKind: "property-set", lane: "regexp-named-groups", authoredPropertyKey: true, shape: { op: "set", target: { form: "free-call", path: "js_abi::regexp_named_groups_set", receiverMode: "ref" }, params: [{ ref: "option-of-string" }] } },
  { owner: regexpNamedGroupsOwner, member: "index", operationKind: "index-set", lane: "regexp-named-groups", shape: { op: "set", target: { form: "receiver-method", name: "set", argModes: ["ref", "value"] }, params: [{ ref: "string" }, { ref: "option-of-string" }] } },
  { owner: regexpNamedGroupsOwner, member: "index", operationKind: "delete", lane: "regexp-named-groups", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: regexpNamedIndicesOwner, member: "index", operationKind: "property", lane: "regexp-named-indices", authoredPropertyKey: true, shape: { op: "operation", operationKind: "property", target: { form: "free-call", path: "js_abi::regexp_named_indices_get", receiverMode: "ref" }, result: { ref: "option-of-regexp-index-pair" }, sourceResult: { ref: "regexp-index-pair" }, sourceAbsence: "undefined" } },
  { owner: regexpNamedIndicesOwner, member: "index", operationKind: "indexer", lane: "regexp-named-indices", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "get", argModes: ["ref"] }, result: { ref: "option-of-regexp-index-pair" }, sourceResult: { ref: "regexp-index-pair" }, sourceAbsence: "undefined", params: [{ ref: "string" }] } },
  { owner: regexpNamedIndicesOwner, member: "index", operationKind: "property-set", lane: "regexp-named-indices", authoredPropertyKey: true, shape: { op: "set", target: { form: "free-call", path: "js_abi::regexp_named_indices_set", receiverMode: "ref" }, params: [{ ref: "option-of-regexp-index-pair" }] } },
  { owner: regexpNamedIndicesOwner, member: "index", operationKind: "index-set", lane: "regexp-named-indices", shape: { op: "set", target: { form: "receiver-method", name: "set", argModes: ["ref", "value"] }, params: [{ ref: "string" }, { ref: "option-of-regexp-index-pair" }] } },
  { owner: regexpNamedIndicesOwner, member: "index", operationKind: "delete", lane: "regexp-named-indices", shape: { op: "operation", operationKind: "indexer", target: { form: "receiver-method", name: "delete", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },

  // RegExp lane: exact selected operations over the complete built-in runtime contract.
  { owner: regexpConstructorOwner, member: regexpConstructorMembers.escape, operationKind: "call", lane: "regexp", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsRegExp::escape", argModes: ["ref"] }, result: { ref: "string" }, params: [{ ref: "string" }] } },
  { owner: regexpOwner, member: regexpMembers.test, operationKind: "call", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "test", argModes: ["ref"] }, result: { ref: "bool" }, params: [{ ref: "string" }] } },
  { owner: regexpOwner, member: regexpMembers.exec, operationKind: "call", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "exec", argModes: ["ref"] }, result: { ref: "option-of-regexp-exec-array" }, sourceResult: { ref: "regexp-exec-array" }, sourceAbsence: "null", params: [{ ref: "string" }] } },
  { owner: regexpOwner, member: regexpMembers.toString, operationKind: "call", lane: "regexp", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_string_value" }, result: { ref: "string" } } },
  { owner: regexpOwner, member: regexpWellKnownMembers.match, operationKind: "call", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "match_result", argModes: ["ref"] }, result: { ref: "option-of-regexp-match-array" }, sourceResult: { ref: "regexp-match-array" }, sourceAbsence: "null", params: [{ ref: "string" }] } },
  { owner: regexpOwner, member: regexpWellKnownMembers.matchAll, operationKind: "call", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "match_all", argModes: ["ref"] }, result: { ref: "regexp-string-iterator" }, params: [{ ref: "string" }] } },
  { owner: regexpOwner, member: regexpWellKnownMembers.replace, operationKind: "call", lane: "regexp", variant: "string", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "replace", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [{ ref: "string" }, { ref: "string" }] } },
  { owner: regexpOwner, member: regexpWellKnownMembers.replace, operationKind: "call", lane: "regexp", variant: "callback", fallible: true, callback: regexpReplacementCallbackOperation({ form: "receiver-method", name: "try_replace_with", argModes: ["ref", "value"] }), shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "replace_with", argModes: ["ref", "value"] }, result: { ref: "string" }, params: [{ ref: "string" }, { ref: "argument", index: 1 }] } },
  { owner: regexpOwner, member: regexpWellKnownMembers.search, operationKind: "call", lane: "regexp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "search", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: regexpOwner, member: regexpWellKnownMembers.split, operationKind: "call", lane: "regexp", variant: "default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "split_all", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "string" }] } },
  { owner: regexpOwner, member: regexpWellKnownMembers.split, operationKind: "call", lane: "regexp", variant: "limit", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "split_with_limit", argModes: ["ref", "value"] }, result: { ref: "string-array" }, params: [{ ref: "string" }, { ref: "float64" }] } },
  { owner: regexpOwner, member: regexpMembers.source, operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "source" }, result: { ref: "string" } } },
  { owner: regexpOwner, member: regexpMembers.flags, operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "flags" }, result: { ref: "string" } } },
  ...([
    [regexpMembers.global, "global"],
    [regexpMembers.hasIndices, "has_indices"],
    [regexpMembers.ignoreCase, "ignore_case"],
    [regexpMembers.multiline, "multiline"],
    [regexpMembers.dotAll, "dot_all"],
    [regexpMembers.sticky, "sticky"],
    [regexpMembers.unicode, "unicode"],
    [regexpMembers.unicodeSets, "unicode_sets"],
  ] as const).map(([member, name]): JsOperationRowData => ({ owner: regexpOwner, member, operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name }, result: { ref: "bool" } } })),
  { owner: regexpOwner, member: regexpMembers.lastIndex, operationKind: "property", lane: "regexp", shape: { op: "operation", operationKind: "property", target: { form: "receiver-method", name: "last_index" }, result: { ref: "float64" } } },
  { owner: regexpOwner, member: regexpMembers.lastIndex, operationKind: "property-set", lane: "regexp", shape: { op: "set", target: { form: "receiver-method", name: "set_last_index" }, params: [{ ref: "float64" }] } },

  // String integration selects the built-in RegExp or string carrier exactly.
  { owner: stringOwner, member: regexpStringMembers.match, operationKind: "call", lane: "string", variant: "regexp", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "match_result", argModes: ["ref"] }, result: { ref: "option-of-regexp-match-array" }, sourceResult: { ref: "regexp-match-array" }, sourceAbsence: "null", params: [{ ref: "regexp" }] } },
  { owner: stringOwner, member: regexpStringMembers.match, operationKind: "call", lane: "string", variant: "string", firstArgCarrierId: "rust.js.JsString", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::regexp_match_string", receiverMode: "ref", argModes: ["ref"] }, result: { ref: "option-of-regexp-match-array" }, sourceResult: { ref: "regexp-match-array" }, sourceAbsence: "null", params: [{ ref: "string" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "float64-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start", receiverMode: "ref", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "float64-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start_with", receiverMode: "ref", argModes: ["value", "ref"] }, result: { ref: "string" }, params: [{ ref: "float64" }, { ref: "string" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "int32-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start", receiverMode: "ref", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "String", member: "padStart", operationKind: "call", lane: "string", variant: "int32-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_start_with", receiverMode: "ref", argModes: ["value", "ref"], argConversions: [rustInt32ToFloat64ValueConversion, undefined] }, result: { ref: "string" }, params: [{ ref: "int32" }, { ref: "string" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "float64-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end", receiverMode: "ref", argModes: ["value"] }, result: { ref: "string" }, params: [{ ref: "float64" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "float64-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end_with", receiverMode: "ref", argModes: ["value", "ref"] }, result: { ref: "string" }, params: [{ ref: "float64" }, { ref: "string" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "int32-default", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end", receiverMode: "ref", argModes: ["value"], argConversions: [rustInt32ToFloat64ValueConversion] }, result: { ref: "string" }, params: [{ ref: "int32" }] } },
  { owner: "String", member: "padEnd", operationKind: "call", lane: "string", variant: "int32-fill", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_string::pad_end_with", receiverMode: "ref", argModes: ["value", "ref"], argConversions: [rustInt32ToFloat64ValueConversion, undefined] }, result: { ref: "string" }, params: [{ ref: "int32" }, { ref: "string" }] } },
  { owner: stringOwner, member: regexpStringMembers.matchAll, operationKind: "call", lane: "string", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "match_all_for_string", argModes: ["ref"] }, result: { ref: "regexp-string-iterator" }, params: [{ ref: "regexp" }] } },
  { owner: stringOwner, member: regexpStringMembers.replace, operationKind: "call", lane: "string", variant: "regexp", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "replace", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [{ ref: "regexp" }, { ref: "string" }] } },
  { owner: stringOwner, member: regexpStringMembers.replace, operationKind: "call", lane: "string", variant: "regexp-callback", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, callback: regexpReplacementCallbackOperation({ form: "arg-receiver-method", name: "try_replace_with", argModes: ["ref", "value"] }), shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "replace_with", argModes: ["ref", "value"] }, result: { ref: "string" }, params: [{ ref: "regexp" }, { ref: "argument", index: 1 }] } },
  { owner: stringOwner, member: regexpStringMembers.replaceAll, operationKind: "call", lane: "string", variant: "regexp", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "replace_all_for_string", argModes: ["ref", "ref"] }, result: { ref: "string" }, params: [{ ref: "regexp" }, { ref: "string" }] } },
  { owner: stringOwner, member: regexpStringMembers.replaceAll, operationKind: "call", lane: "string", variant: "regexp-callback", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, callback: regexpReplacementCallbackOperation({ form: "arg-receiver-method", name: "try_replace_all_for_string_with", argModes: ["ref", "value"] }), shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "replace_all_for_string_with", argModes: ["ref", "value"] }, result: { ref: "string" }, params: [{ ref: "regexp" }, { ref: "argument", index: 1 }] } },
  { owner: stringOwner, member: regexpStringMembers.search, operationKind: "call", lane: "string", variant: "regexp", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "search", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "regexp" }] } },
  { owner: stringOwner, member: regexpStringMembers.search, operationKind: "call", lane: "string", variant: "string", firstArgCarrierId: "rust.js.JsString", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::regexp_search_string", receiverMode: "ref", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  { owner: stringOwner, member: regexpStringMembers.split, operationKind: "call", lane: "string", variant: "regexp-default", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "split_all", argModes: ["ref"] }, result: { ref: "string-array" }, params: [{ ref: "regexp" }] } },
  { owner: stringOwner, member: regexpStringMembers.split, operationKind: "call", lane: "string", variant: "regexp-limit", firstArgCarrierId: "rust.js.JsRegExp", fallible: true, shape: { op: "operation", operationKind: "method", target: { form: "arg-receiver-method", name: "split_with_limit", argModes: ["ref", "value"] }, result: { ref: "string-array" }, params: [{ ref: "regexp" }, { ref: "float64" }] } },
  { owner: regexpStringIteratorOwner, member: regexpWellKnownMembers.iterator, operationKind: "call", lane: "regexp-string-iterator", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "iterator" }, result: { ref: "regexp-string-iterator" } } },

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

  { owner: "Boolean", member: "toString", operationKind: "call", lane: "boolean", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::boolean_to_string", receiverMode: "value" }, result: { ref: "string" } } },
  { owner: "Boolean", member: "valueOf", operationKind: "call", lane: "boolean", shape: { op: "operation", operationKind: "method", target: { form: "free-call", path: "js_abi::boolean_value_of", receiverMode: "value" }, result: { ref: "bool" } } },

  // Date lane.
  { owner: "DateConstructor", member: "parse", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "call", path: "js_abi::JsDate::parse", argModes: ["ref"] }, result: { ref: "float64" }, params: [{ ref: "string" }] } },
  ...dateUtcRows(),
  { owner: "Date", member: "toJSON", operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name: "to_json" }, result: { ref: "string" } } },
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
  ] as const).map(([member, name]): JsOperationRowData => ({ owner: "Date", member, operationKind: "call", lane: "date", shape: { op: "operation", operationKind: "method", target: { form: "receiver-method", name }, result: { ref: "float64" } } })),
  ...dateReceiverNumberRows("setTime", ["set_time"]),
  ...dateReceiverNumberRows("setUTCMilliseconds", ["set_utc_milliseconds"]),
  ...dateReceiverNumberRows("setUTCSeconds", ["set_utc_seconds", "set_utc_seconds_milliseconds"]),
  ...dateReceiverNumberRows("setUTCMinutes", ["set_utc_minutes", "set_utc_minutes_seconds", "set_utc_minutes_seconds_milliseconds"]),
  ...dateReceiverNumberRows("setUTCHours", ["set_utc_hours", "set_utc_hours_minutes", "set_utc_hours_minutes_seconds", "set_utc_hours_minutes_seconds_milliseconds"]),
  ...dateReceiverNumberRows("setUTCDate", ["set_utc_date"]),
  ...dateReceiverNumberRows("setUTCMonth", ["set_utc_month", "set_utc_month_date"]),
  ...dateReceiverNumberRows("setUTCFullYear", ["set_utc_full_year", "set_utc_full_year_month", "set_utc_full_year_month_date"]),
]);

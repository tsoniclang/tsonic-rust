import { jsSourceSemanticsIdentity } from "@tsonic/js-source-profile";
import {
  rustInt32ToFloat64ValueConversion,
  rustIsizeToInt32ValueConversion,
  rustUsizeToInt32ValueConversion,
} from "../../../target-model/conversions/model.js";
import { rustJsStringTargetId } from "../../../target-model/types/index.js";
import type { JsOperationRowData } from "./model.js";

const owner = jsSourceSemanticsIdentity.typeExport;
const zero = { kind: "integer", value: 0 } as const;
const none = { kind: "none" } as const;
const numberArguments = [
  { variant: "float64", carrier: { ref: "float64" } as const, conversion: undefined },
  { variant: "int32", carrier: { ref: "int32" } as const, conversion: rustInt32ToFloat64ValueConversion },
] as const;
const numberArgumentPairs = numberArguments.flatMap((first) =>
  numberArguments.map((second) => ({ first, second })),
);
const exactUnaryStringRows: readonly {
  readonly member: string;
  readonly target: string;
  readonly result: "js-string" | "bool" | "string";
}[] = [
  { member: "trim", target: "trim", result: "js-string" },
  { member: "trimStart", target: "trim_start", result: "js-string" },
  { member: "trimEnd", target: "trim_end", result: "js-string" },
  { member: "toLowerCase", target: "to_lower_case", result: "js-string" },
  { member: "toUpperCase", target: "to_upper_case", result: "js-string" },
  { member: "toString", target: "identity", result: "js-string" },
  { member: "valueOf", target: "identity", result: "js-string" },
  { member: "isWellFormed", target: "is_well_formed", result: "bool" },
  { member: "toWellFormed", target: "to_well_formed", result: "string" },
];

export const exactJsStringOperationRows: readonly JsOperationRowData[] = Object.freeze([
  {
    owner,
    member: "length",
    operationKind: "property",
    lane: "js-string",
    shape: {
      op: "operation",
      operationKind: "property",
      target: { form: "free-call", path: "js_exact_string::js_len", receiverMode: "ref" },
      result: { ref: "int32" },
      resultConversion: rustUsizeToInt32ValueConversion,
      evaluation: "pure",
    },
  },
  ...numberArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({
    owner,
    member: "index",
    operationKind: "indexer",
    lane: "js-string",
    variant,
    shape: {
      op: "operation",
      operationKind: "indexer",
      target: {
        form: "free-call",
        path: "js_exact_string::char_at",
        receiverMode: "ref",
        argModes: ["value"],
        argConversions: [conversion],
      },
      result: { ref: "js-string" },
      params: [carrier],
      evaluation: "pure",
    },
  })),
  ...[
    { member: "includes", target: "includes", defaultTarget: "includes_from_start", result: { ref: "bool" } as const },
    { member: "startsWith", target: "starts_with", defaultTarget: "starts_with_from_start", result: { ref: "bool" } as const },
    { member: "endsWith", target: "ends_with", defaultTarget: "ends_with_at_end", result: { ref: "bool" } as const },
    { member: "indexOf", target: "index_of", defaultTarget: "index_of_from_start", result: { ref: "int32" } as const, resultConversion: rustIsizeToInt32ValueConversion },
    { member: "lastIndexOf", target: "last_index_of", defaultTarget: "last_index_of_from_end", result: { ref: "int32" } as const, resultConversion: rustIsizeToInt32ValueConversion },
  ].flatMap((row): readonly JsOperationRowData[] => [
    {
      owner,
      member: row.member,
      operationKind: "call",
      lane: "js-string",
      variant: "default",
      shape: {
        op: "operation",
        operationKind: "method",
        target: {
          form: "free-call",
          path: `js_exact_string::${row.defaultTarget}`,
          receiverMode: "ref",
          argModes: ["ref"],
        },
        result: row.result,
        ...("resultConversion" in row ? { resultConversion: row.resultConversion } : {}),
        params: [{ ref: "js-string" }],
      },
    },
    ...numberArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({
      owner,
      member: row.member,
      operationKind: "call",
      lane: "js-string",
      variant,
      shape: {
        op: "operation",
        operationKind: "method",
        target: {
          form: "free-call",
          path: `js_exact_string::${row.target}`,
          receiverMode: "ref",
          argModes: ["ref", "value"],
          argConversions: [undefined, conversion],
        },
        result: row.result,
        ...("resultConversion" in row ? { resultConversion: row.resultConversion } : {}),
        params: [{ ref: "js-string" }, carrier],
      },
    })),
  ]),
  ...[
    { member: "charAt", target: "char_at", result: { ref: "js-string" } as const },
    { member: "charCodeAt", target: "char_code_at", result: { ref: "float64" } as const },
    { member: "codePointAt", target: "code_point_at", result: { ref: "option-of-float64" } as const, sourceResult: { ref: "float64" } as const },
    { member: "at", target: "at", result: { ref: "option-of-js-string" } as const, sourceResult: { ref: "js-string" } as const },
    { member: "repeat", target: "repeat", result: { ref: "js-string" } as const, fallible: true },
  ].flatMap((row) => numberArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({
    owner,
    member: row.member,
    operationKind: "call",
    lane: "js-string",
    variant,
    ...(row.fallible === true ? { fallible: true } : {}),
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "free-call",
        path: `js_exact_string::${row.target}`,
        receiverMode: "ref",
        argModes: ["value"],
        argConversions: [conversion],
      },
      result: row.result,
      ...(row.sourceResult === undefined
        ? {}
        : { sourceResult: row.sourceResult, sourceAbsence: "undefined" as const }),
      params: [carrier],
    },
  }))),
  {
    owner,
    member: "slice",
    operationKind: "call",
    lane: "js-string",
    variant: "default",
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "free-call",
        path: "js_exact_string::slice",
        receiverMode: "ref",
        trailingArguments: [zero, none],
      },
      result: { ref: "js-string" },
    },
  },
  ...numberArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({
    owner,
    member: "slice",
    operationKind: "call",
    lane: "js-string",
    variant: `start-${variant}`,
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "free-call",
        path: "js_exact_string::slice",
        receiverMode: "ref",
        argConversions: [conversion],
        trailingArguments: [none],
      },
      result: { ref: "js-string" },
      params: [carrier],
    },
  })),
  ...numberArgumentPairs.map(({ first, second }): JsOperationRowData => ({
    owner,
    member: "slice",
    operationKind: "call",
    lane: "js-string",
    variant: `start-${first.variant}-end-${second.variant}`,
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "free-call",
        path: "js_exact_string::slice_to",
        receiverMode: "ref",
        argConversions: [first.conversion, second.conversion],
      },
      result: { ref: "js-string" },
      params: [first.carrier, second.carrier],
    },
  })),
  ...(["substring", "substr"] as const).flatMap((member): readonly JsOperationRowData[] => [
    ...numberArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({
      owner,
      member,
      operationKind: "call",
      lane: "js-string",
      variant: `start-${variant}`,
      shape: {
        op: "operation",
        operationKind: "method",
        target: {
          form: "free-call",
          path: `js_exact_string::${member}_from`,
          receiverMode: "ref",
          argConversions: [conversion],
        },
        result: { ref: "js-string" },
        params: [carrier],
      },
    })),
    ...numberArgumentPairs.map(({ first, second }): JsOperationRowData => ({
      owner,
      member,
      operationKind: "call",
      lane: "js-string",
      variant: `start-${first.variant}-end-${second.variant}`,
      shape: {
        op: "operation",
        operationKind: "method",
        target: {
          form: "free-call",
          path: `js_exact_string::${member}`,
          receiverMode: "ref",
          argConversions: [first.conversion, second.conversion],
        },
        result: { ref: "js-string" },
        params: [first.carrier, second.carrier],
      },
    })),
  ]),
  {
    owner,
    member: "concat",
    operationKind: "call",
    lane: "js-string",
    variadic: true,
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "receiver-value-array",
        name: "concat_values",
        receiverMode: "ref",
        leadingArguments: [],
        elementCarrier: { kind: "target-named", id: rustJsStringTargetId },
      },
      result: { ref: "js-string" },
    },
  },
  ...(["padStart", "padEnd"] as const).flatMap((member) => {
    const target = member === "padStart" ? "pad_start" : "pad_end";
    return numberArguments.flatMap(({ variant, carrier, conversion }): readonly JsOperationRowData[] => [
      {
        owner,
        member,
        operationKind: "call",
        lane: "js-string",
        variant: `${variant}-default`,
        fallible: true,
        shape: {
          op: "operation",
          operationKind: "method",
          target: {
            form: "free-call",
            path: `js_exact_string::${target}`,
            receiverMode: "ref",
            argModes: ["value"],
            argConversions: [conversion],
          },
          result: { ref: "js-string" },
          params: [carrier],
        },
      },
      {
        owner,
        member,
        operationKind: "call",
        lane: "js-string",
        variant: `${variant}-fill`,
        fallible: true,
        shape: {
          op: "operation",
          operationKind: "method",
          target: {
            form: "free-call",
            path: `js_exact_string::${target}_with`,
            receiverMode: "ref",
            argModes: ["value", "ref"],
            argConversions: [conversion, undefined],
          },
          result: { ref: "js-string" },
          params: [carrier, { ref: "js-string" }],
        },
      },
    ]);
  }),
  {
    owner,
    member: "normalize",
    operationKind: "call",
    lane: "js-string",
    variant: "default",
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "free-call", path: "js_exact_string::normalize", receiverMode: "ref" },
      result: { ref: "js-string" },
    },
  },
  {
    owner,
    member: "normalize",
    operationKind: "call",
    lane: "js-string",
    variant: "form",
    fallible: true,
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "free-call",
        path: "js_exact_string::normalize_with_form",
        receiverMode: "ref",
        argModes: ["ref"],
      },
      result: { ref: "js-string" },
      params: [{ ref: "string" }],
    },
  },
  ...exactUnaryStringRows.map(({ member, target, result }): JsOperationRowData => ({
    owner,
    member,
    operationKind: "call",
    lane: "js-string",
    shape: {
      op: "operation",
      operationKind: "method",
      target: { form: "free-call", path: `js_exact_string::${target}`, receiverMode: "ref" },
      result: { ref: result },
    },
  })),
  {
    owner,
    member: "split",
    operationKind: "call",
    lane: "js-string",
    variant: "string-default",
    firstArgCarrierId: rustJsStringTargetId,
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "free-call",
        path: "js_exact_string::split_all",
        receiverMode: "ref",
        argModes: ["ref"],
      },
      result: { ref: "js-string-array" },
      params: [{ ref: "js-string" }],
    },
  },
  ...numberArguments.map(({ variant, carrier, conversion }): JsOperationRowData => ({
    owner,
    member: "split",
    operationKind: "call",
    lane: "js-string",
    variant: `string-limit-${variant}`,
    firstArgCarrierId: rustJsStringTargetId,
    shape: {
      op: "operation",
      operationKind: "method",
      target: {
        form: "free-call",
        path: "js_exact_string::split",
        receiverMode: "ref",
        argModes: ["ref", "value"],
        argConversions: [undefined, conversion],
      },
      result: { ref: "js-string-array" },
      params: [{ ref: "js-string" }, carrier],
    },
  })),
]);

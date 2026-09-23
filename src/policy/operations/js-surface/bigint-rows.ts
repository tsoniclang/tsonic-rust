import type { JsOperationRowData } from "./model.js";

export const bigintOperationRows: readonly JsOperationRowData[] = [
  {
    owner: "NumberConstructor", member: "call", operationKind: "call", lane: "number",
    variant: "numeric-scalar",
    requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "numeric" }],
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "numeric-cast", target: "float64" },
      params: [{ ref: "argument", index: 0 }], result: { ref: "float64" },
    },
  },
  ...([
    ["NumberConstructor", "number", "to_number", "float64", false],
    ["BigIntConstructor", "bigint", "to_bigint", "bigint", true],
  ] as const).map(([owner, lane, method, result, fallible]): JsOperationRowData => ({
    owner, member: "call", operationKind: "call", lane, variant: "numeric-parameter", fallible,
    requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "numeric-parameter" }],
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: `js_abi::SourceNumeric::${method}`, argModes: ["ref"] },
      params: [{ ref: "argument", index: 0 }], result: { ref: result },
    },
  })),
  {
    owner: "BigInt", member: "toString", operationKind: "call", lane: "bigint",
    variant: "default",
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "free-call", path: "ToString::to_string", receiverMode: "ref" },
      result: { ref: "string" },
    },
  },
  {
    owner: "BigInt", member: "toString", operationKind: "call", lane: "bigint",
    variant: "radix", fallible: true,
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "free-call", path: "js_abi::bigint_to_string_radix", receiverMode: "ref", argModes: ["value"] },
      params: [{ ref: "float64" }], result: { ref: "string" },
    },
  },
  ...([
    ["asIntN", "js_abi::bigint_as_int_n"],
    ["asUintN", "js_abi::bigint_as_uint_n"],
  ] as const).flatMap(([member, path]) => (["bigint", "integer"] as const).map((variant): JsOperationRowData => ({
    owner: "BigIntConstructor", member, operationKind: "call", lane: "bigint", variant, fallible: true,
    ...(variant === "integer" ? {
      requirements: [{ carrier: { ref: "argument" as const, index: 1 }, capability: "integer" as const }],
    } : {}),
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path, argModes: ["value", "ref"] },
      params: [{ ref: "float64" }, variant === "bigint" ? { ref: "bigint" } : { ref: "argument", index: 1 }],
      result: { ref: "bigint" },
    },
  }))),
  {
    owner: "BigIntConstructor", member: "call", operationKind: "call", lane: "bigint",
    variant: "numeric-union", fallible: true,
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "js_abi::JsNumeric::to_bigint", argModes: ["ref"] },
      params: [{ ref: "js-numeric" }], result: { ref: "bigint" },
    },
  },
  {
    owner: "NumberConstructor", member: "call", operationKind: "call", lane: "number",
    variant: "numeric-union",
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "js_abi::JsNumeric::to_number", argModes: ["ref"] },
      params: [{ ref: "js-numeric" }], result: { ref: "float64" },
    },
  },
  {
    owner: "NumberConstructor", member: "call", operationKind: "call", lane: "number",
    variant: "bigint",
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "js_abi::bigint_to_number", argModes: ["ref"] },
      params: [{ ref: "bigint" }], result: { ref: "float64" },
    },
  },
  {
    owner: "BigIntConstructor", member: "call", operationKind: "call", lane: "bigint",
    variant: "integer",
    requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "integer" }],
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "js_abi::bigint_from_integer" },
      params: [{ ref: "argument", index: 0 }], result: { ref: "bigint" },
    },
  },
  {
    owner: "BigIntConstructor", member: "call", operationKind: "call", lane: "bigint",
    variant: "number", fallible: true,
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "js_abi::bigint_from_number" },
      params: [{ ref: "float64" }], result: { ref: "bigint" },
    },
  },
  {
    owner: "BigIntConstructor", member: "call", operationKind: "call", lane: "bigint",
    variant: "boolean",
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "js_abi::bigint_from_boolean" },
      params: [{ ref: "bool" }], result: { ref: "bigint" },
    },
  },
  {
    owner: "BigIntConstructor", member: "call", operationKind: "call", lane: "bigint",
    variant: "string", fallible: true,
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "js_abi::bigint_from_string", argModes: ["ref"] },
      params: [{ ref: "string" }], result: { ref: "bigint" },
    },
  },
  {
    owner: "BigIntConstructor", member: "call", operationKind: "call", lane: "bigint",
    variant: "bigint",
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "Clone::clone", argModes: ["ref"] },
      params: [{ ref: "bigint" }], result: { ref: "bigint" },
    },
  },
];

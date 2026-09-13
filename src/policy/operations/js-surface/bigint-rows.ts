import type { JsOperationRowData } from "./model.js";

export const bigintOperationRows: readonly JsOperationRowData[] = [
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

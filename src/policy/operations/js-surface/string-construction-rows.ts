import type { JsOperationRowData } from "./model.js";

export const stringConstructionRows: readonly JsOperationRowData[] = [
  {
    owner: "StringConstructor", member: "call", operationKind: "call", lane: "string",
    variant: "empty",
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "String::new" }, result: { ref: "string" },
    },
  },
  {
    owner: "StringConstructor", member: "call", operationKind: "call", lane: "string",
    variant: "primitive",
    requirements: [{ carrier: { ref: "argument", index: 0 }, capability: "stringifiable" }],
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "rt::source_string", argModes: ["ref"] },
      params: [{ ref: "argument", index: 0 }], result: { ref: "string" },
    },
  },
  {
    owner: "StringConstructor", member: "call", operationKind: "call", lane: "string",
    variant: "numeric-union",
    shape: {
      op: "operation", operationKind: "method",
      target: { form: "call", path: "rt::source_string", argModes: ["ref"] },
      params: [{ ref: "js-numeric" }], result: { ref: "string" },
    },
  },
];

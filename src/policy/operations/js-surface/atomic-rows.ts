import type { JsOperationRowData } from "./model.js";

export const atomicOperationRows: readonly JsOperationRowData[] = [
  { member: "wait", path: "atomics_wait", arguments: 4, result: "string" },
  { member: "wait", path: "atomics_wait_forever", arguments: 3, result: "string" },
  { member: "notify", path: "atomics_notify", arguments: 3, result: "float64" },
  { member: "notify", path: "atomics_notify_all", arguments: 2, result: "float64" },
  { member: "load", path: "atomics_load", arguments: 2, result: "float64" },
  { member: "store", path: "atomics_store", arguments: 3, result: "float64" },
].map((row): JsOperationRowData => ({
  owner: "Atomics", member: row.member, operationKind: "call", lane: "global",
  variant: String(row.arguments), fallible: true,
  shape: {
    op: "operation", operationKind: "method",
    target: { form: "call", path: `js_abi::${row.path}`,
      argModes: ["ref", ...Array.from({ length: row.arguments - 1 }, () => "value" as const)] },
    params: [{ ref: "int32-array" }, ...Array.from({ length: row.arguments - 1 }, () => ({ ref: "float64" as const }))],
    result: row.result === "string" ? { ref: "string" } : { ref: "float64" },
  },
}));

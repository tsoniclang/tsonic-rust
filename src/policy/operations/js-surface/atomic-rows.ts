import type { JsOperationRowData } from "./model.js";

export const atomicOperationRows: readonly JsOperationRowData[] = ([
  { member: "wait", path: "atomics_wait", arguments: 4, result: "string" },
  { member: "wait", path: "atomics_wait_forever", arguments: 3, result: "string" },
  { member: "notify", path: "atomics_notify", arguments: 3, result: "native-uint" },
  { member: "notify", path: "atomics_notify_all", arguments: 2, result: "native-uint" },
  { member: "load", path: "atomics_load", arguments: 2, result: "int32" },
  { member: "store", path: "atomics_store", arguments: 3, result: "numeric-argument" },
] satisfies readonly { member: string; path: string; arguments: number; result: "string" | "native-uint" | "int32" | "numeric-argument" }[]).map((row): JsOperationRowData => ({
  owner: "Atomics", member: row.member, operationKind: "call", lane: "global",
  variant: String(row.arguments), fallible: true,
  shape: {
    op: "operation", operationKind: "method",
    target: { form: "call", path: `js_abi::${row.path}`,
      argModes: ["ref", ...Array.from({ length: row.arguments - 1 }, () => "value" as const)] },
    params: [{ ref: "int32-array" }, ...Array.from({ length: row.arguments - 1 }, (_, index) =>
      row.member === "wait" && index === 2 ? { ref: "float64" as const } : { ref: "numeric-argument" as const, index: index + 1 })],
    result: row.result === "numeric-argument" ? { ref: "numeric-argument", index: 2 } : { ref: row.result },
  },
}));

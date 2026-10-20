import type { RustExpr } from "./nodes.js";

export function rustPartialOrderingTest(left: RustExpr, right: RustExpr, operator: "==" | "!=",
  ordering: "Less" | "Equal" | "Greater"): RustExpr {
  return { kind: "binary", operator,
    left: { kind: "method-call", receiver: left, method: "partial_cmp", args: [{ kind: "reference", expr: right }] },
    right: { kind: "call", path: "Some", args: [{ kind: "associated-value", owner: { kind: "named", path: "core::cmp::Ordering" }, name: ordering }] } };
}

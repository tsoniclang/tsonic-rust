import type { RustExpr } from "./nodes.js";

export function rustPartialOrderingTest(left: RustExpr, right: RustExpr, operator: "==" | "!=",
  ordering: "Less" | "Equal" | "Greater"): RustExpr {
  return { kind: "binary", operator,
    left: { kind: "method-call", receiver: left, method: "partial_cmp", args: [{ kind: "reference", expr: right }] },
    right: { kind: "call", path: "Some", args: [{ kind: "associated-value", owner: { kind: "named", path: "core::cmp::Ordering" }, name: ordering }] } };
}

/** NaN-correct negation of an ordered float comparison: `!(left < right)` is `partial_cmp` absent or not `Less`. */
export function rustNegatedFloatOrdering(left: RustExpr, right: RustExpr, operator: "<" | "<=" | ">" | ">="): RustExpr {
  const ordering: RustExpr = { kind: "path", path: "ordering" };
  return { kind: "method-call",
    receiver: { kind: "method-call", receiver: left, method: "partial_cmp", args: [{ kind: "reference", expr: right }] },
    method: "is_none_or",
    args: [{ kind: "closure", params: [{ name: "ordering", byRefCopy: false }], body: { kind: "binary",
      operator: operator === "<" || operator === ">" ? "!=" : "==", left: ordering,
      right: { kind: "associated-value", owner: { kind: "named", path: "core::cmp::Ordering" },
        name: operator === "<" || operator === "<=" ? "Less" : "Greater" } } }] };
}

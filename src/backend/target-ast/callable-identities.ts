import type { RustExpr } from "./nodes.js";

export function rustCallableIdentityPredicate(
  kind: "declaration" | "activation", left: RustExpr, right: RustExpr,
): RustExpr {
  return kind === "declaration" ? { kind: "bool-literal", value: true }
    : { kind: "call", path: "core::ptr::addr_eq", args: [left, right].map(expression => ({
        kind: "call", path: "alloc::rc::Rc::as_ptr", args: [expression],
      })) };
}

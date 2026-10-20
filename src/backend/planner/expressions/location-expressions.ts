import type { RustExpr } from "../../target-ast/syntax/nodes.js";

export function optionReference(value: RustExpr): RustExpr {
  return { kind: "method-call", receiver: value, method: "as_ref", args: [] };
}

import type { RustExpr } from "../../target-ast/syntax/nodes.js";

// A method call auto-borrows its receiver, so a shared reference this planner built for a by-reference receiver
// prints as the place itself; `(&x).method()` is clippy::needless_borrow. Mutable references are kept.
export function rustAutoBorrowedReceiver(receiver: RustExpr): RustExpr {
  return receiver.kind === "reference" && receiver.mutable !== true ? receiver.expr : receiver;
}

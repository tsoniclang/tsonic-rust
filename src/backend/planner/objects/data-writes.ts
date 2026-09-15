import type { RustFrozenWriteReceiver } from "../../../analysis/objects/frozen-data-writes.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import { rustTargetRuntimeErrorType } from "../types/error-boundary.js";

export function checkRustDataWrite(
  mode: RustFrozenWriteReceiver,
  receiver: RustExpr,
  effect: RustExpr,
  errorType: RustType,
): RustExpr {
  return { kind: "evaluate-then", discard: "unit", value: effect, effect: {
    kind: "try", operandErrorType: rustTargetRuntimeErrorType, resultErrorType: errorType,
    expr: { kind: "method-call", receiver: mode === "receiver" ? receiver : { kind: "field", receiver, name: mode },
      method: "validate_data_write", args: [] },
  } };
}

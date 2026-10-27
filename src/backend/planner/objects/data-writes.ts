import type { RustFrozenWriteReceiver } from "../../../target-model/records/storage/field-writes.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import { rustPropagateLocalError, type RustFallibleBoundary } from "../program/fallible-boundaries.js";

export function checkRustDataWrite(
  mode: RustFrozenWriteReceiver,
  receiver: RustExpr,
  effect: RustExpr,
  region: RustFallibleBoundary,
): RustExpr | undefined {
  const checked = rustPropagateLocalError(region, rustTargetRuntimeErrorType, {
    kind: "method-call", receiver: mode === "receiver" ? receiver : { kind: "field", receiver, name: mode },
    method: "validate_data_write", args: [],
  });
  return checked === undefined ? undefined : { kind: "evaluate-then", discard: "unit", value: effect, effect: checked };
}

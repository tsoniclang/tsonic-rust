import type { RustFallibleErrorBoundary } from "../../../policy/operations/error-boundary.js";
import type { RustExpr, RustType } from "../../rust-ast/nodes.js";
import { rustRuntimeErrorTypeIdentity } from "../program/source-package-errors.js";

export const rustTargetRuntimeErrorType: RustType = Object.freeze({
  kind: "named",
  path: "tsonic_rust_runtime::TsonicError",
  identity: rustRuntimeErrorTypeIdentity,
});

export function applyRustErrorBoundary(
  expression: RustExpr,
  boundary: RustFallibleErrorBoundary,
  currentErrorType: RustType,
  providerErrorType?: RustType,
): RustExpr {
  if (boundary === "provider-native" && providerErrorType === undefined) {
    throw new Error("A provider-native Rust error boundary requires one exact provider error type.");
  }
  return {
    kind: "try",
    expr: expression,
    resultErrorType: currentErrorType,
    operandErrorType: boundary === "provider-native"
      ? providerErrorType!
      : boundary === "target-runtime" ? rustTargetRuntimeErrorType : currentErrorType,
  };
}

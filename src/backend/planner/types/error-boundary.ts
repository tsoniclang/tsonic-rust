import type { RustFallibleErrorBoundary } from "../../../target-model/operations/error-boundary.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import { rustRuntimeErrorTypeIdentity } from "../../../target-model/operations/error-boundary.js";
import { rustErrorType, rustLocalErrorOwner, rustPropagateLocalError,
  type RustFallibleBoundary } from "../program/fallible-boundaries.js";

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
  return {
    kind: "try",
    expr: expression,
    resultErrorType: currentErrorType,
    operandErrorType: rustErrorBoundaryOperandType(boundary, currentErrorType, providerErrorType),
  };
}

export function applyRustLocalErrorBoundary(
  expression: RustExpr,
  boundary: RustFallibleErrorBoundary,
  region: RustFallibleBoundary,
  providerErrorType?: RustType,
): RustExpr | undefined {
  const owner = rustLocalErrorOwner(region);
  return owner === undefined ? undefined : rustPropagateLocalError(region,
    rustErrorBoundaryOperandType(boundary, rustErrorType(owner), providerErrorType), expression);
}

export function rustErrorBoundaryOperandType(
  boundary: RustFallibleErrorBoundary,
  currentErrorType: RustType,
  providerErrorType?: RustType,
): RustType {
  if (boundary === "provider-native" && providerErrorType === undefined) {
    throw new Error("A provider-native Rust error boundary requires one exact provider error type.");
  }
  return boundary === "provider-native" ? providerErrorType!
    : boundary === "target-runtime" ? rustTargetRuntimeErrorType : currentErrorType;
}

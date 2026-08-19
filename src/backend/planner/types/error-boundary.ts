import type { RustFallibleErrorBoundary } from "../../../policy/operations/error-boundary.js";
import { rustErrorBoundaryDomain } from "../../../policy/operations/error-boundary.js";
import type { TargetTypeRef } from "../../../policy/types/model.js";
import type { RustErrorDomain, RustExpr } from "../../rust-ast/nodes.js";

export function applyRustErrorBoundary(
  expression: RustExpr,
  boundary: RustFallibleErrorBoundary,
  currentDomain: RustErrorDomain,
  errorCarrier?: TargetTypeRef,
): RustExpr {
  if (boundary === "provider-native" && errorCarrier === undefined) {
    throw new Error("A provider-native Rust error boundary requires one exact provider error carrier.");
  }
  return {
    kind: "try",
    expr: expression,
    errorDomain: rustErrorBoundaryDomain(boundary) === "current"
      ? currentDomain
      : "runtime",
  };
}

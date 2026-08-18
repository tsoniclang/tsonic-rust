import type { RustFallibleErrorBoundary } from "../../../policy/operations/error-boundary.js";
import { rustErrorBoundaryDomain } from "../../../policy/operations/error-boundary.js";
import type { RustErrorDomain, RustExpr } from "../../rust-ast/nodes.js";

export function applyRustErrorBoundary(
  expression: RustExpr,
  boundary: RustFallibleErrorBoundary,
  currentDomain: RustErrorDomain,
): RustExpr {
  const converted = boundary === "provider-native"
    ? {
        kind: "method-call" as const,
        receiver: expression,
        method: "map_err",
        args: [{ kind: "path" as const, path: "tsonic_rust_runtime::TsonicError::from" }],
      }
    : expression;
  return {
    kind: "try",
    expr: converted,
    errorDomain: rustErrorBoundaryDomain(boundary) === "current"
      ? currentDomain
      : "runtime",
  };
}

import { rustNamedTargetType } from "../types/carriers/native.js";
import type { TargetTypeRef } from "../types/model.js";

export const rustRuntimeErrorTypeIdentity = "tsonic-rust-runtime:TsonicError";

export function rustRuntimeErrorTargetType(): TargetTypeRef {
  return rustNamedTargetType(rustRuntimeErrorTypeIdentity, "tsonic_rust_runtime::TsonicError",
    [], [], undefined, [], rustRuntimeErrorTypeIdentity, []);
}

export type RustFallibleErrorBoundary =
  | "provider-native"
  | "target-runtime"
  | "source-program";

export type RustErrorBoundary = "none" | RustFallibleErrorBoundary;

export type RustAwaitedErrorBoundary = RustFallibleErrorBoundary | "js-rejection";

export type RustOperationErrorBoundary = "none" | RustAwaitedErrorBoundary;

export type RustErrorDomain = "runtime" | "project";

export function isRustFallibleErrorBoundary(
  value: unknown,
): value is RustFallibleErrorBoundary {
  return value === "provider-native" || value === "target-runtime" || value === "source-program";
}

export function isRustAwaitedErrorBoundary(value: unknown): value is RustAwaitedErrorBoundary {
  return value === "js-rejection" || isRustFallibleErrorBoundary(value);
}

export function isRustErrorBoundary(value: unknown): value is RustErrorBoundary {
  return value === "none" || isRustFallibleErrorBoundary(value);
}

export function isRustOperationErrorBoundary(value: unknown): value is RustOperationErrorBoundary {
  return value === "none" || isRustAwaitedErrorBoundary(value);
}

export function rustErrorBoundaryDomain(
  boundary: RustFallibleErrorBoundary,
): "runtime" | "current" {
  switch (boundary) {
    case "provider-native":
    case "target-runtime":
      return "runtime";
    case "source-program":
      return "current";
  }
}

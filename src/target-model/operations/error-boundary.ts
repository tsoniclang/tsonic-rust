export type RustFallibleErrorBoundary =
  | "provider-native"
  | "target-runtime"
  | "source-program";

export type RustErrorBoundary = "none" | RustFallibleErrorBoundary;

export type RustErrorDomain = "runtime" | "project";

export function isRustFallibleErrorBoundary(
  value: unknown,
): value is RustFallibleErrorBoundary {
  return value === "provider-native" || value === "target-runtime" || value === "source-program";
}

export function isRustErrorBoundary(value: unknown): value is RustErrorBoundary {
  return value === "none" || isRustFallibleErrorBoundary(value);
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

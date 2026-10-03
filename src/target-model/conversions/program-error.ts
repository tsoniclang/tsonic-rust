import type { TargetTypeRef } from "../types/model.js";
import { isRustProgramErrorCarrier, rustJsErrorTargetType, rustSourceTypeCarrierValue } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { hasExactObjectKeys } from "../metadata/closed-data.js";

export type RustProgramErrorRoute =
  | { readonly kind: "runtime"; readonly boundary: "target-runtime" | "provider-native" }
  | { readonly kind: "project"; readonly variant: string };

export interface RustProgramErrorConversion {
  readonly kind: "program-error";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly route: RustProgramErrorRoute;
}

export function selectRustRuntimeErrorBoundary(
  carrier: TargetTypeRef,
  providerErrorCarriers: readonly TargetTypeRef[],
): "target-runtime" | "provider-native" | undefined {
  if (rustTargetTypeRefEquals(carrier, rustJsErrorTargetType())) return "target-runtime";
  return providerErrorCarriers.some(candidate => rustTargetTypeRefEquals(candidate, carrier))
    ? "provider-native" : undefined;
}

export function rustProgramErrorConversionMatches(
  conversion: RustProgramErrorConversion, source: TargetTypeRef, target: TargetTypeRef,
): boolean {
  if (!hasExactObjectKeys(conversion, ["kind", "source", "target", "route"]) ||
    !rustTargetTypeRefEquals(source, conversion.source) || !rustTargetTypeRefEquals(target, conversion.target) ||
    !isRustProgramErrorCarrier(target) || typeof conversion.route !== "object" || conversion.route === null) return false;
  const route = conversion.route;
  if (route.kind === "runtime") {
    return hasExactObjectKeys(route, ["kind", "boundary"]) && (route.boundary === "provider-native" ||
      route.boundary === "target-runtime" && rustTargetTypeRefEquals(source, rustJsErrorTargetType()));
  }
  return route.kind === "project" && hasExactObjectKeys(route, ["kind", "variant"]) &&
    typeof route.variant === "string" && route.variant.length > 0 &&
    rustSourceTypeCarrierValue(source)?.shape === "object";
}

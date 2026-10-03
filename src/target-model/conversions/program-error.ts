import type { TargetTypeRef } from "../types/model.js";
import { isRustProgramErrorCarrier, rustJsErrorTargetType, rustSourceTypeCarrierValue } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { closedMetadataEquals, hasExactObjectKeys, isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";
import { rustUnionLeaves, type RustUnionLeaf } from "../types/union-relations.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../types/source-union-definitions.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier } from "../types/carriers/source-error.js";

export type RustProgramErrorRoute =
  | { readonly kind: "source-error" }
  | { readonly kind: "source-created" }
  | { readonly kind: "runtime"; readonly boundary: "target-runtime" | "provider-native" }
  | { readonly kind: "project"; readonly variant: string }
  | { readonly kind: "union"; readonly arms: readonly (RustUnionLeaf & { readonly route: RustProgramErrorRoute })[] };

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
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  return isClosedMetadata(conversion) && hasExactObjectKeys(conversion, ["kind", "source", "target", "route"]) &&
    conversion.kind === "program-error" && rustTargetTypeRefEquals(source, conversion.source) &&
    rustTargetTypeRefEquals(target, conversion.target) && (isRustProgramErrorCarrier(target) || isRustSourceErrorCarrier(target)) &&
    (!isRustSourceErrorCarrier(target) || !isRustSourceErrorCarrier(source) ||
      !isRustWritableSourceErrorCarrier(target) && isRustWritableSourceErrorCarrier(source)) &&
    (!isRustWritableSourceErrorCarrier(target) || writableRouteMatches(conversion.route)) &&
    rustProgramErrorRouteMatches(conversion.route, source, definitions);
}

function rustProgramErrorRouteMatches(
  route: RustProgramErrorRoute, source: TargetTypeRef, definitions: RustTypeDefinitions,
): boolean {
  if (typeof route !== "object" || route === null) return false;
  if (route.kind === "source-created") return hasExactObjectKeys(route, ["kind"]) && isRustMutableJsErrorCarrier(source);
  if (route.kind === "source-error") {
    return hasExactObjectKeys(route, ["kind"]) && isRustSourceErrorCarrier(source);
  }
  if (route.kind === "union") {
    if (!hasExactObjectKeys(route, ["kind", "arms"]) || !isDenseDataArray(route.arms)) return false;
    const leaves = rustUnionLeaves(source, definitions);
    return leaves !== undefined && leaves.length === route.arms.length && leaves.every((leaf, index) => {
      const arm = route.arms[index];
      return arm !== undefined && hasExactObjectKeys(arm, ["carrier", "path", "route"]) &&
        closedMetadataEquals(leaf, { carrier: arm.carrier, path: arm.path }) &&
        rustProgramErrorRouteMatches(arm.route, leaf.carrier, definitions);
    });
  }
  if (route.kind === "runtime") {
    return hasExactObjectKeys(route, ["kind", "boundary"]) && (route.boundary === "provider-native" ||
      route.boundary === "target-runtime" && rustTargetTypeRefEquals(source, rustJsErrorTargetType()));
  }
  return route.kind === "project" && hasExactObjectKeys(route, ["kind", "variant"]) &&
    typeof route.variant === "string" && route.variant.length > 0 &&
    rustSourceTypeCarrierValue(source)?.shape === "object";
}

function writableRouteMatches(route: RustProgramErrorRoute): boolean {
  return route.kind === "source-created" || route.kind === "project" ||
    route.kind === "union" && route.arms.every(arm => writableRouteMatches(arm.route));
}

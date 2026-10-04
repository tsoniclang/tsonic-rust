import type { TargetTypeRef } from "../types/model.js";
import { isRustProgramErrorCarrier, rustProgramErrorTargetType, rustJsErrorTargetType, rustSourceTypeCarrierValue } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { closedMetadataEquals, hasExactObjectKeys, isClosedMetadata, isDenseDataArray } from "../metadata/closed-data.js";
import { rustUnionLeaves, type RustUnionLeaf } from "../types/union-relations.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../types/source-union-definitions.js";
import { isRustMutableJsErrorCarrier, isRustSourceErrorCarrier, isRustWritableSourceErrorCarrier, rustWritableSourceErrorTargetType } from "../types/carriers/source-error.js";

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

export function mapRustProgramErrorRoute(
  route: RustProgramErrorRoute,
  mapCarrier: (carrier: TargetTypeRef) => TargetTypeRef,
): RustProgramErrorRoute {
  return route.kind !== "union" ? route : Object.freeze({ kind: "union", arms: Object.freeze(route.arms.map(arm =>
    Object.freeze({ carrier: mapCarrier(arm.carrier), path: Object.freeze(arm.path.map(step =>
      Object.freeze({ ...step, union: mapCarrier(step.union) }))), route: mapRustProgramErrorRoute(arm.route, mapCarrier) }))) });
}

export function rustProgramErrorRouteCarriers(route: RustProgramErrorRoute): readonly TargetTypeRef[] {
  return route.kind !== "union" ? [] : route.arms.flatMap(arm =>
    [arm.carrier, ...arm.path.map(step => step.union), ...rustProgramErrorRouteCarriers(arm.route)]);
}

function selectRustIntrinsicErrorRoute(
  source: TargetTypeRef,
  target: TargetTypeRef,
): RustProgramErrorRoute | undefined {
  if (!isRustProgramErrorCarrier(target) && !isRustSourceErrorCarrier(target)) return undefined;
  if (isRustSourceErrorCarrier(source) && (!isRustSourceErrorCarrier(target) ||
    !isRustWritableSourceErrorCarrier(target) && isRustWritableSourceErrorCarrier(source))) {
    return Object.freeze({ kind: "source-error" });
  }
  if (isRustMutableJsErrorCarrier(source)) return Object.freeze({ kind: "source-created" });
  return !isRustWritableSourceErrorCarrier(target) && rustTargetTypeRefEquals(source, rustJsErrorTargetType())
    ? Object.freeze({ kind: "runtime", boundary: "target-runtime" }) : undefined;
}

export function selectRustProgramErrorConversion(
  source: TargetTypeRef,
  target: TargetTypeRef = rustProgramErrorTargetType(),
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): RustProgramErrorConversion | undefined {
  if (!isRustProgramErrorCarrier(target) && !isRustSourceErrorCarrier(target)) return undefined;
  const sourceError = isRustSourceErrorCarrier(target);
  const selectRoute = (carrier: TargetTypeRef): RustProgramErrorRoute | undefined => {
    const intrinsic = selectRustIntrinsicErrorRoute(carrier, target);
    if (intrinsic !== undefined) return intrinsic;
    const origin = definitions.programErrorOrigin(carrier);
    if (origin?.kind === "provider" && !isRustWritableSourceErrorCarrier(target)) {
      return Object.freeze({ kind: "runtime", boundary: "provider-native" });
    }
    if (origin?.kind === "project" && (!sourceError || origin.sourceError)) {
      return Object.freeze({ kind: "project", variant: origin.variant });
    }
    const leaves = rustUnionLeaves(carrier, definitions);
    if (leaves === undefined) return undefined;
    const arms: Extract<RustProgramErrorRoute, { kind: "union" }>["arms"][number][] = [];
    for (const leaf of leaves) {
      const route = selectRoute(leaf.carrier);
      if (route === undefined) return undefined;
      arms.push(Object.freeze({ ...leaf, route }));
    }
    return Object.freeze({ kind: "union", arms: Object.freeze(arms) });
  };
  const route = selectRoute(source);
  return route === undefined ? undefined : Object.freeze({ kind: "program-error", source, target, route });
}

export function rustWritableErrorRecoveryOriginMatches(source: TargetTypeRef, definitions: RustTypeDefinitions): boolean {
  const writable = rustWritableSourceErrorTargetType();
  if (isRustWritableSourceErrorCarrier(source) || selectRustProgramErrorConversion(source, writable, definitions) !== undefined) return true;
  const transport = selectRustProgramErrorConversion(source, rustProgramErrorTargetType(), definitions);
  if (transport?.route.kind === "project") {
    const origin = definitions.programErrorOrigin(source);
    return origin?.kind === "project" && !origin.sourceError;
  }
  return transport?.route.kind === "union" && transport.route.arms.every(arm =>
    rustWritableErrorRecoveryOriginMatches(arm.carrier, definitions));
}

export function selectRustRuntimeErrorBoundary(
  carrier: TargetTypeRef,
  providerErrorCarriers: readonly TargetTypeRef[],
): "target-runtime" | "provider-native" | undefined {
  if (rustTargetTypeRefEquals(carrier, rustJsErrorTargetType())) return "target-runtime";
  return providerErrorCarriers.some(candidate => rustTargetTypeRefEquals(candidate, carrier))
    ? "provider-native" : undefined;
}

export function rustProgramErrorRuntimeRouteMatches(
  route: Extract<RustProgramErrorRoute, { readonly kind: "runtime" }>,
  carrier: TargetTypeRef,
  providerErrorCarriers: readonly TargetTypeRef[],
): boolean {
  return route.boundary === "target-runtime"
    ? rustTargetTypeRefEquals(carrier, rustJsErrorTargetType())
    : route.boundary === "provider-native" &&
      !rustTargetTypeRefEquals(carrier, rustJsErrorTargetType()) &&
      providerErrorCarriers.some(candidate => rustTargetTypeRefEquals(candidate, carrier));
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
    rustProgramErrorRouteMatches(conversion.route, source, definitions) &&
    closedMetadataEquals(conversion.route, selectRustProgramErrorConversion(source, target, definitions)?.route);
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
    return hasExactObjectKeys(route, ["kind", "boundary"]) && (route.boundary === "provider-native" &&
      definitions.programErrorOrigin(source)?.kind === "provider" ||
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

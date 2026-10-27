import type { TargetTypeRef } from "../types/model.js";

import { type RustUnionLeaf } from "../types/union-relations.js";

import { type RustClosedValueAdmissionConversion } from "./closed-admission.js";

export type RustProgramErrorRoute =
  | { readonly kind: "identity" }
  | { readonly kind: "closed" }
  | { readonly kind: "closed-admission"; readonly admission: RustClosedValueAdmissionConversion }
  | { readonly kind: "source-error" }
  | { readonly kind: "source-created" }
  | { readonly kind: "retained" }
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
  if (route.kind === "closed-admission") return Object.freeze({ ...route,
    admission: route.admission.kind === "semantic-conversion" ? route.admission :
      Object.freeze({ ...route.admission, source: mapCarrier(route.admission.source) }) });
  return route.kind !== "union" ? route : Object.freeze({ kind: "union", arms: Object.freeze(route.arms.map(arm =>
    Object.freeze({ carrier: mapCarrier(arm.carrier), path: Object.freeze(arm.path.map(step =>
      Object.freeze({ ...step, union: mapCarrier(step.union) }))), route: mapRustProgramErrorRoute(arm.route, mapCarrier) }))) });
}

export function rustProgramErrorRouteCarriers(route: RustProgramErrorRoute): readonly TargetTypeRef[] {
  if (route.kind === "closed-admission") return route.admission.kind === "semantic-conversion" ? [] : [route.admission.source];
  return route.kind !== "union" ? [] : route.arms.flatMap(arm =>
    [arm.carrier, ...arm.path.map(step => step.union), ...rustProgramErrorRouteCarriers(arm.route)]);
}

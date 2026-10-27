import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustErrorDomain } from "../../operations/error-boundary.js";
import type { RustObjectRepresentation } from "./object-representation.js";
import type { RustProjectDowncastRoute } from "../../types/project-types.js";
import type { RustProjectProjectionSelection } from "../../types/project-projections.js";

export interface RustClosedNativeProjectionEmission {
  readonly carrier: TargetTypeRef;
  readonly representation: RustObjectRepresentation;
  readonly payload: "value" | "dispatch" | "state";
  readonly query: "none" | "native_value" | "native_shared";
  readonly optional: boolean;
}

export type RustProjectClosedValueEmission = { readonly kind: "error" } | { readonly kind: "value" } | { readonly kind: "shared"; readonly representation: RustObjectRepresentation };

export interface RustProjectProjectionEmission {
  readonly carrier: TargetTypeRef;
  readonly optional: boolean;
  readonly projection: RustProjectProjectionSelection;
  readonly route: RustProjectDowncastRoute | undefined;
}

export interface RustObjectProjectionRecords {
  readonly closedNativeProjection: { readonly get: (node: Node, source: TargetTypeRef, target: TargetTypeRef, domain: RustErrorDomain) => RustClosedNativeProjectionEmission | undefined };
  readonly projectProjection: { readonly get: (node: Node, source: TargetTypeRef, target: TargetTypeRef) => RustProjectProjectionEmission | undefined };
  readonly projectClosedValue: { readonly get: (carrier: TargetTypeRef) => RustProjectClosedValueEmission | undefined };
}

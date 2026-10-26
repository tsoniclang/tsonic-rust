import type { RustFlowReadProjectionFact } from "./value-projections.js";
import type { RustUnionMappingEmission, RustUnionProjectionEmission } from "./union-mappings.js";

export type RustFlowReadEmission =
  | { readonly kind: "identity" }
  | { readonly kind: "builtin-error"; readonly source: "closed" | "program" | "source" | "retained" | "native";
      readonly target: "source" | "retained" | "native"; readonly writable: boolean; readonly mutable: boolean; readonly runtimeReadonly: boolean }
  | { readonly kind: "union-map"; readonly mapping: RustUnionMappingEmission }
  | { readonly kind: "union"; readonly projection: RustUnionProjectionEmission }
  | { readonly kind: "option"; readonly custom: boolean; readonly reborrow: boolean; readonly readonlyReference: boolean }
  | { readonly kind: "closed-native" | "program-error-variant" | "project" };

export interface RustFlowReadEmissionRecords {
  readonly flowReadEmission: { readonly get: (fact: RustFlowReadProjectionFact) => RustFlowReadEmission | undefined };
}

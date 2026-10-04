import type { TargetTypeRef } from "../types/model.js";
import type { RustRuntimeUnionVariant } from "../types/carriers/runtime-unions.js";

export type RustClosedTypePredicate =
  | { readonly kind: "nominal"; readonly targetCarrier: TargetTypeRef }
  | { readonly kind: "error"; readonly errorKind: "any" | "RangeError" | "TypeError" | "URIError" }
  | { readonly kind: "array" };

export interface RustProjectTypeTestPlan {
  readonly sourceCarrier: TargetTypeRef;
  readonly dispatchCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly lowering:
    | { readonly kind: "dispatch" }
    | { readonly kind: "constant"; readonly value: boolean }
    | { readonly kind: "option-presence" };
}

export type RustClosedTypeTestPlan =
  | { readonly kind: "constant"; readonly value: boolean }
  | { readonly kind: "error"; readonly lowering: "native-error" | "closed-value" | "program-error" }
  | { readonly kind: "runtime-array" }
  | { readonly kind: "project"; readonly plan: RustProjectTypeTestPlan }
  | { readonly kind: "option"; readonly element: TargetTypeRef; readonly test: RustClosedTypeTestPlan }
  | { readonly kind: "union"; readonly arms: readonly {
      readonly carrier: TargetTypeRef;
      readonly variant: RustRuntimeUnionVariant;
      readonly test: RustClosedTypeTestPlan;
    }[] };

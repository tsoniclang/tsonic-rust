import type { RustCapturedGeneric, RustBinder } from "./generics.js";
import type { RustLifetimeRef } from "./lifetimes.js";
import type { RustTraitRef, RustTypeRef } from "./types.js";

export type RustBound =
  | {
      readonly kind: "trait";
      readonly binder?: RustBinder;
      readonly trait: RustTraitRef;
      readonly polarity: "required" | "maybe" | "negative";
    }
  | {
      readonly kind: "lifetime-outlives";
      readonly longer: RustLifetimeRef;
      readonly shorter: RustLifetimeRef;
    }
  | {
      readonly kind: "type-outlives";
      readonly type: RustTypeRef;
      readonly lifetime: RustLifetimeRef;
    }
  | {
      readonly kind: "associated-equality";
      readonly projection: Extract<RustTypeRef, { readonly kind: "associated-type" }>;
      readonly value: RustTypeRef;
    }
  | {
      readonly kind: "precise-capture";
      readonly captures: readonly RustCapturedGeneric[];
    };

export type RustWherePredicate =
  | {
      readonly kind: "type";
      readonly binder?: RustBinder;
      readonly type: RustTypeRef;
      readonly bounds: readonly RustBound[];
    }
  | {
      readonly kind: "lifetime";
      readonly lifetime: RustLifetimeRef;
      readonly outlives: readonly RustLifetimeRef[];
    }
  | {
      readonly kind: "equality";
      readonly projection: Extract<RustTypeRef, { readonly kind: "associated-type" }>;
      readonly value: RustTypeRef;
    };

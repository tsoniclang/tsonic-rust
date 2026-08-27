import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustContextualValueConversion } from "../../target-model/conversions/contextual.js";

export type RustOptionProjectionFact =
  | {
      readonly kind: "none";
      readonly sourceCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "some";
      readonly sourceCarrier: TargetTypeRef;
      readonly elementCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    };

export type RustFlowReadProjectionFact =
  | {
      readonly kind: "option-value";
      readonly sourceCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "project-downcast";
      readonly sourceCarrier: TargetTypeRef;
      readonly dispatchCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "program-error-variant";
      readonly sourceCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
      readonly variant: string;
    };

export interface RustContextualValueConversionFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly conversion: RustContextualValueConversion;
}

export interface RustCallScopedLifetimeReconciliationFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly selectedCarrier: TargetTypeRef;
}

export interface RustProjectUpcastFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

export interface RustProjectDowncastFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly dispatchCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

export type RustSourceBindingFact =
  | {
      readonly scope: "lexical";
      readonly sourceName: string;
      readonly sourceDeclaration: Node;
    }
  | {
      readonly scope: "module";
      readonly sourceName: string;
      readonly fileName: string;
      readonly sourceDeclaration: Node;
    };

export type RustBindingProjection =
  | {
      readonly kind: "object-field";
      readonly storage: "project-object" | "object-handle";
      readonly storageIndex: number;
      readonly accessor?: {
        readonly getter: true;
        readonly setter: boolean;
      };
    }
  | {
      readonly kind: "object-rest";
      readonly storage: "project-object" | "object-handle";
      readonly fields: readonly {
        readonly sourceStorageIndex: number;
        readonly targetStorageIndex: number;
        readonly carrier: TargetTypeRef;
        readonly accessor?: {
          readonly getter: true;
          readonly setter: boolean;
        };
      }[];
    }
  | { readonly kind: "tuple-element"; readonly index: number }
  | { readonly kind: "fixed-array-element"; readonly index: number }
  | { readonly kind: "vec-element"; readonly index: number; readonly checked: boolean }
  | { readonly kind: "js-array-element"; readonly index: number }
  | { readonly kind: "tuple-rest"; readonly start: number }
  | { readonly kind: "fixed-array-rest"; readonly start: number }
  | { readonly kind: "vec-rest"; readonly start: number }
  | { readonly kind: "js-array-rest"; readonly start: number };

export type RustBindingNormalization =
  | "identity"
  | "expect-some"
  | "flatten-option"
  | "default-on-none"
  | "flatten-expect-some"
  | "flatten-default-on-none";

export interface RustBindingProjectionFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly projectedCarrier: TargetTypeRef;
  readonly bindingCarrier: TargetTypeRef;
  readonly projection: RustBindingProjection;
  readonly normalization: RustBindingNormalization;
}

import type { Node } from "@tsonic/tsts";
export interface RustSelectedBindingProjection {
  readonly projectedCarrier: TargetTypeRef;
  readonly projection: Exclude<RustBindingProjection, { readonly kind: "omitted" }>;
  readonly checkedArrayElement?: TargetTypeRef;
}
import type { RustBindingNormalization } from "../../types/binding-normalization.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustContextualValueConversion } from "../../conversions/contextual.js";
import type { RustProjectProjectionSelection, RustProjectDowncastFact } from "../../types/project-projections.js";
import type { RustUnionArmMapping } from "../../types/union-relations.js";

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

interface RustUnionFlowReadProjection {
  readonly sourceCarrier: TargetTypeRef;
  readonly dispatchCarrier: TargetTypeRef;
  readonly selectedCarrier: TargetTypeRef;
  readonly variant: string;
  readonly project?: RustProjectDowncastFact;
}

export type RustFlowReadProjectionFact =
  | {
      readonly kind: "union-map";
      readonly sourceCarrier: TargetTypeRef;
      readonly dispatchCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
      readonly arms: readonly RustUnionArmMapping[];
    }
  | (RustUnionFlowReadProjection & { readonly kind: "source-union" })
  | (RustUnionFlowReadProjection & { readonly kind: "runtime-union" })
  | {
      readonly kind: "builtin-error";
      readonly sourceCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "option-value";
      readonly sourceCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "option-reference";
      readonly sourceCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "project-downcast";
      readonly projection: RustProjectProjectionSelection;
      readonly sourceCarrier: TargetTypeRef;
      readonly dispatchCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "closed-native";
      readonly sourceCarrier: TargetTypeRef;
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
  readonly sourceVariants?: readonly {
    readonly name: string;
    readonly carrier: TargetTypeRef;
  }[];
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
  | { readonly kind: "omitted" }
  | {
      readonly kind: "object-field";
      readonly storage: "project-object" | "structural-object";
      readonly storageIndex: number;
      readonly accessor?: {
        readonly getter: true;
        readonly setter: boolean;
      };
    }
  | {
      readonly kind: "object-rest";
      readonly storage: "project-object" | "structural-object";
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

export interface RustBindingValueProjectionFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly projectedCarrier: TargetTypeRef;
  readonly storageCarrier: TargetTypeRef;
  readonly bindingCarrier: TargetTypeRef;
  readonly projection: Exclude<RustBindingProjection, { readonly kind: "omitted" }>;
  readonly normalization: RustBindingNormalization;
}

export type RustBindingProjectionFact = RustBindingValueProjectionFact | {
  readonly sourceCarrier: TargetTypeRef;
  readonly projection: { readonly kind: "omitted" };
};

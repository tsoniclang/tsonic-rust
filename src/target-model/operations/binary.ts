import type { TargetTypeRef } from "../types/model.js";
import type { RustBinaryOperator, RustOperationSymbol } from "../syntax/tokens.js";
import type { RustArgumentMode, RustValueConversion } from "./model.js";
import type { RustUnionPathStep } from "../types/union-relations.js";

export type RustBinaryOperatorSelection =
  | {
      readonly kind: "operator-token";
      readonly rustOperator: RustBinaryOperator;
      readonly resultCarrier: TargetTypeRef;
      readonly leftConversion?: RustValueConversion;
      readonly rightConversion?: RustValueConversion;
    }
  | {
      readonly kind: "operator-call";
      readonly rustOperator: RustOperationSymbol;
      readonly resultCarrier: TargetTypeRef;
      readonly path: string;
      readonly fallible: boolean;
      readonly operandModes: readonly [RustArgumentMode, RustArgumentMode];
      readonly leftConversion?: RustValueConversion;
      readonly rightConversion?: RustValueConversion;
    }
  | {
      readonly kind: "string-concat";
      readonly rustOperator: "+";
      readonly resultCarrier: TargetTypeRef;
    };

export interface RustUnionEqualityArm {
  readonly left: { readonly carrier: TargetTypeRef; readonly path: readonly RustUnionPathStep[] };
  readonly right: { readonly carrier: TargetTypeRef; readonly path: readonly RustUnionPathStep[] };
  readonly operation: Exclude<RustBinaryOperatorSelection, { readonly kind: "string-concat" }>;
}

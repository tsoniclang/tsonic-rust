import type { RustTargetOperationFact } from "./operations.js";
import type { RustValueConversionContract } from "../../conversions/contracts.js";
import type { RustUnionEqualityArm } from "../../operations/binary.js";

export interface RustUnionEqualityOperand {
  readonly arm: RustUnionEqualityArm["left"];
  readonly optional: boolean;
  readonly absence: boolean;
  readonly value: { readonly kind: "constant"; readonly value: boolean } | { readonly kind: "borrowed" };
}

export interface RustUnionEqualityEmission {
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "union-equality" }>;
  readonly form: { readonly kind: "constant"; readonly value: boolean } | { readonly kind: "matches" | "match" };
  readonly unmatchedResult: boolean;
  readonly arms: readonly {
    readonly left: RustUnionEqualityOperand;
    readonly right: RustUnionEqualityOperand;
    readonly operation: RustUnionEqualityArm["operation"];
    readonly constant: boolean | undefined;
    readonly booleanOperand: { readonly side: "left" | "right"; readonly negated: boolean } | undefined;
    readonly leftConversion: RustValueConversionContract | undefined;
    readonly rightConversion: RustValueConversionContract | undefined;
  }[];
}

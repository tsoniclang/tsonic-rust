import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "./operations.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustUpdateMember, RustUpdateProjectField } from "../storage/direct-storage.js";

export type RustUnaryEmission =
  | { readonly kind: "identity"; readonly operand: Node; readonly literal: boolean; readonly carrier: TargetTypeRef }
  | { readonly kind: "unary"; readonly operand: Node; readonly literal: boolean; readonly booleanNot: boolean;
      readonly fact: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }> }
  | RustUnaryUpdateEmission;

export interface RustUnaryUpdateEmission {
  readonly kind: "update";
  readonly operand: Node;
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>;
  readonly step: "bigint" | "float" | "integer";
  readonly postfix: boolean;
  readonly directDiscard: boolean;
  readonly location:
    | { readonly kind: "runtime" | "value-field" | "promoted" | "direct" }
    | RustUpdateMember
    | { readonly kind: "field"; readonly selection: RustUpdateProjectField };
}

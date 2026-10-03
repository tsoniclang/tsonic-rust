import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustValueConversion } from "../../../target-model/operations/model.js";

export interface RustBorrowedSequenceInput {
  readonly expression: Node;
  readonly controlNodes: readonly Node[];
  readonly inputs: readonly (
    | { readonly kind: "empty"; readonly expression: Node }
    | { readonly kind: "sequence"; readonly expression: Node; readonly carrier: TargetTypeRef;
        readonly presentCarrier: TargetTypeRef; readonly optional: boolean;
        readonly conversion: Extract<RustValueConversion, { readonly kind: "rest-sequence" }> }
  )[];
}

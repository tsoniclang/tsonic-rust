import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export type RustStringAppendPart =
  | { readonly kind: "character"; readonly value: string }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "expression"; readonly expression: Node };

export interface RustAssignmentWriteCompletion {
  readonly target: Node;
  readonly value: Node;
  readonly valueField: boolean;
  readonly deferReceiverBorrow: boolean;
  readonly valueResult: { readonly carrier: TargetTypeRef; readonly copy: boolean } | undefined;
  readonly stringAppend: {
    readonly receiver: "direct" | "borrow-cell";
    readonly parts: readonly RustStringAppendPart[];
  } | undefined;
}

import type { Node } from "@tsonic/tsts";

export type RustStringAppendPart =
  | { readonly kind: "character"; readonly value: string }
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "expression"; readonly expression: Node };

export interface RustAssignmentWriteCompletion {
  readonly target: Node;
  readonly value: Node;
  readonly valueField: boolean;
  readonly deferReceiverBorrow: boolean;
  readonly stringAppend: {
    readonly receiver: "direct" | "borrow-cell";
    readonly parts: readonly RustStringAppendPart[];
  } | undefined;
}

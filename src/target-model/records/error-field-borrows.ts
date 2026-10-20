import type { Node } from "@tsonic/tsts";

export type RustErrorFieldEmission =
  | { readonly kind: "ordinary" }
  | { readonly kind: "property"; readonly expression: Node; readonly receiver: Node;
      readonly property: "message" | "name" | "stack"; readonly receiverForm: "direct" | "closed" | "program";
      readonly guarded: boolean; readonly shared: boolean; readonly directRead: boolean };

export interface RustErrorFieldRecords {
  readonly errorFieldEmission: { readonly get: (node: Node) => RustErrorFieldEmission | undefined };
  readonly errorFieldSnapshot: { readonly get: (node: Node, later: Node) => boolean | undefined };
}

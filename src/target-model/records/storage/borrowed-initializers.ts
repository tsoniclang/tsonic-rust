import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustBorrowedInitializer {
  readonly receiver: Node;
  readonly carrier: TargetTypeRef;
  readonly retained: readonly { readonly expression: Node; readonly carrier: TargetTypeRef }[];
  readonly loan: {
    readonly declaration: Node;
    readonly initializer: Node;
    readonly guard: Node;
    readonly parameter: Node;
    readonly returnCarrier: Extract<TargetTypeRef, { readonly kind: "reference" }>;
    readonly resultCarrier: Extract<TargetTypeRef, { readonly kind: "reference" }>;
  } | undefined;
}

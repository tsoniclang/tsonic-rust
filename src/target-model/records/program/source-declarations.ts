import type { TargetTypeRef } from "../../types/model.js";
import type { Node } from "@tsonic/tsts";

export interface RustSourceCallableReturnFact {
  readonly returnCarrier: TargetTypeRef;
  readonly borrowedReturn?: {
    readonly parameter: Node;
    readonly carrier: TargetTypeRef;
  };
  readonly implementationCompletion?: "absence" | "diverging";
  readonly canFallThrough?: boolean;
  readonly undefinedReturn?: boolean;
  readonly fallthroughUndefined?: boolean;
}

import type { TargetTypeRef } from "../../types/model.js";
import type { Node } from "@tsonic/tsts";

export interface RustSourceCallableReturnFact {
  readonly returnCarrier: TargetTypeRef;
  readonly borrowedParameter?: Node;
  readonly implementationCompletion?: "absence" | "diverging";
  readonly canFallThrough?: boolean;
  readonly undefinedReturn?: boolean;
  readonly fallthroughUndefined?: boolean;
}

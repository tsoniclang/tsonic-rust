import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";

export interface RustClassValueFact {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly carrier: TargetTypeRef;
}

import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustIndexedLocationEmission {
  readonly receiver: Node;
  readonly key: Node | undefined;
  readonly stableReceiver: boolean;
  readonly errorCarrier: TargetTypeRef;
}

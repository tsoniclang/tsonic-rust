import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";

export interface RustBorrowedInitializer {
  readonly receiver: Node;
  readonly carrier: TargetTypeRef;
}

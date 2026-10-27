import type { Node } from "@tsonic/tsts";

import type { TargetTypeRef } from "../../types/model.js";

export interface RustOptionalCallGuard {
  readonly guard: Node;
  readonly sourceGuardCarrier: TargetTypeRef;
  readonly selectedGuardCarrier: TargetTypeRef;
}

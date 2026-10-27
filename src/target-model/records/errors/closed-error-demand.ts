import type { TargetTypeRef } from "../../types/model.js";

export interface RustClosedErrorTransportDemand {
  readonly thrownCarriers: readonly TargetTypeRef[];
  readonly retained: boolean;
  readonly sourceView: boolean;
}

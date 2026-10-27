import type { TargetTypeRef } from "../../types/model.js";

export interface RustPointerReturnContract {
  readonly returnCarrier: TargetTypeRef;
  readonly undefinedReturn: boolean;
  readonly fallthroughUndefined: boolean;
}

import type { RustSelectedTargetOperation, RustTargetTypeRef } from "../types/model.js";

export interface RustRuntimeCarrierSelection {
  readonly carrier: RustTargetTypeRef;
}

export interface RustConversionSelection {
  readonly convertedType?: RustTargetTypeRef;
}

export interface RustIterationSelection extends RustSelectedTargetOperation {
  readonly resultType: RustTargetTypeRef;
}

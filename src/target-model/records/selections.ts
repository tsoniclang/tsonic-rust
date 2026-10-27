import type { RustTargetTypeRef } from "../types/model.js";
import type { RustSelectedTargetOperation } from "./operations/member-selections.js";

export interface RustRuntimeCarrierSelection {
  readonly carrier: RustTargetTypeRef;
}

export interface RustConversionSelection {
  readonly convertedType?: RustTargetTypeRef;
}

export interface RustIterationSelection extends RustSelectedTargetOperation {
  readonly resultType: RustTargetTypeRef;
}

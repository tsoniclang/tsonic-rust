import type { TargetTypeRef } from "../types/model.js";

export interface RustCarrierReadEmission {
  readonly copy: boolean;
}

export interface RustCarrierReadRecords {
  readonly carrierRead: { readonly get: (carrier: TargetTypeRef) => RustCarrierReadEmission | undefined };
}

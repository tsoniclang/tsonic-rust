import type { TargetTypeRef } from "../../types/model.js";

export interface RustCarrierReadEmission {
  readonly copy: boolean;
  readonly clone: boolean;
}

export interface RustCarrierReadRecords {
  readonly carrierRead: { readonly get: (carrier: TargetTypeRef) => RustCarrierReadEmission | undefined };
}

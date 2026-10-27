import type { RustProviderTypeRow } from "../../identities/provider-relations.js";

import type { TargetTypeRef } from "../../types/model.js";

export type RustProviderObjectLiteralConstructionSelection =
  | { readonly kind: "not-applicable" }
  | {
    readonly kind: "selected";
    readonly carrier: TargetTypeRef;
    readonly typeRow: RustProviderTypeRow;
  }
  | { readonly kind: "conflict" };

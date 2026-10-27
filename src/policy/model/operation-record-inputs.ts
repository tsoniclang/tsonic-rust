import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustStructuralShapeField, RustStructuralMethodPlan } from "../../target-model/records/objects/structural-shapes.js";

export interface RustStructuralStorageLookup {
  field(
    carrier: TargetTypeRef,
    storageIndex: number,
  ): (Pick<RustStructuralShapeField, "storage" | "presence" | "method"> & {
    readonly methodPlan?: Pick<RustStructuralMethodPlan, "kind" | "carrier" | "receiver">;
  }) | undefined;
}

export interface RustProjectFieldDispatchLookup {
  planFor(declaration: import("@tsonic/tsts").Node): {
    readonly read: { readonly fallible: boolean };
    readonly write?: { readonly fallible: boolean };
  } | undefined;
}

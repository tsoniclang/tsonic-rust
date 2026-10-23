import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustStructuralShapeField } from "../../target-model/records/structural-shapes.js";

export interface RustStructuralStorageLookup {
  field(
    carrier: TargetTypeRef,
    storageIndex: number,
  ): Pick<RustStructuralShapeField, "storage" | "presence" | "method" | "methodPlan"> | undefined;
}

export interface RustProjectFieldDispatchLookup {
  planFor(declaration: import("@tsonic/tsts").Node): {
    readonly read: { readonly fallible: boolean };
    readonly write?: { readonly fallible: boolean };
  } | undefined;
}

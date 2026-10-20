import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function selectReferenceReborrow(
  source: TargetTypeRef,
  target: TargetTypeRef,
  mode: import("../../target-model/operations/model.js").RustArgumentMode | undefined,
): Extract<
  import("../../target-model/conversions/contextual.js").RustContextualValueConversion,
  { readonly kind: "reference-reborrow" }
> | undefined {
  return source.kind === "reference" &&
      (mode === "ref" || mode === "mut-ref" && source.mutable) &&
      rustTargetTypeRefEquals(source.referent, target)
    ? Object.freeze({ kind: "reference-reborrow", source, target })
    : undefined;
}

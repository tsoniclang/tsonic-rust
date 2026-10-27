import type { TargetTypeRef } from "../../types/model.js";

export interface RustRegExpReplacementCallbackEvidence {
  readonly lane: "native" | "exact";
  readonly sourceCarrier: TargetTypeRef;
  readonly projections: readonly (
    | "native-string"
    | "exact-string"
    | "value"
    | "rest-values"
  )[];
}

export interface RustRegExpReplacementCallbackContract extends RustRegExpReplacementCallbackEvidence {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

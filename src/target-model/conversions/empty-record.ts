import type { TargetTypeRef } from "../types/model.js";

export interface RustEmptyRecordConversion {
  readonly kind: "empty-record";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
}

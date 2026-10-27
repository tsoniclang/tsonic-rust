import type { TargetTypeRef } from "../../types/model.js";
import type { RustRecordFamily } from "../program.js";
import type { RustContextualValueConversion } from "../../conversions/contextual.js";

export interface RustValueRead {
  readonly source: TargetTypeRef | undefined;
  readonly value: TargetTypeRef | undefined;
  readonly contextualInput: TargetTypeRef | undefined;
  readonly optionInput: TargetTypeRef | undefined;
  readonly strictEquality: TargetTypeRef | undefined;
  readonly referenceReborrow: Extract<RustContextualValueConversion, { readonly kind: "reference-reborrow" }> | undefined;
}

export interface RustValueReadRecords {
  readonly valueRead: RustRecordFamily<RustValueRead>;
}

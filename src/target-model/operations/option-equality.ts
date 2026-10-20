import type { TargetTypeRef } from "../types/model.js";

export type RustOptionEqualityView = "value" | "str" | "shared";

export interface RustOptionEqualityContract {
  readonly leftCarrier: TargetTypeRef;
  readonly rightCarrier: TargetTypeRef;
  readonly comparisonCarrier: TargetTypeRef;
  readonly leftLiftDepth: number;
  readonly rightLiftDepth: number;
  readonly view: RustOptionEqualityView;
}

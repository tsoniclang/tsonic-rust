import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypePositions } from "../../target-model/records/types/type-emission.js";

export interface RustTypePositionInput {
  readonly carrier: TargetTypeRef;
  readonly children: readonly RustTypePositions[];
  readonly opaque: "none" | "callable" | "input" | "explicit";
  readonly boundPositions: Readonly<Record<"parameter" | "return", boolean>>;
  readonly capturesOpaque: boolean;
  readonly nested: boolean;
}

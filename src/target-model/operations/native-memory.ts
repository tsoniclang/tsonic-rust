import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { defineRustPlanKey } from "../facts/keys.js";

export interface RustNativeMemoryLayout {
  readonly pointeeCarrier: TargetTypeRef;
  readonly size: number;
  readonly alignment: number;
  readonly width: 32 | 64;
  readonly littleEndian: boolean;
}

export function rustNativeMemoryLayoutsEqual(left: RustNativeMemoryLayout, right: RustNativeMemoryLayout): boolean {
  return rustTargetTypeRefEquals(left.pointeeCarrier, right.pointeeCarrier) && left.size === right.size &&
    left.alignment === right.alignment && left.width === right.width && left.littleEndian === right.littleEndian;
}

export const rustNativeBackingKey = defineRustPlanKey<RustNativeMemoryLayout>("nativeBacking", rustNativeMemoryLayoutsEqual);

export interface RustRawLocationPlan {
  readonly operation: "to-raw" | "reinterpret";
  readonly expression: Node;
  readonly inputCarrier: TargetTypeRef;
  readonly layout: RustNativeMemoryLayout;
}

export const rustRawLocationPlanKey = defineRustPlanKey<RustRawLocationPlan>("rawLocation", (left, right) =>
  left.operation === right.operation && left.expression === right.expression &&
  rustTargetTypeRefEquals(left.inputCarrier, right.inputCarrier) && rustNativeMemoryLayoutsEqual(left.layout, right.layout));

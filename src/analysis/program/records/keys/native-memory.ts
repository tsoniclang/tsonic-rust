import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { defineRustPlanKey } from "../key.js";
import type { RustNativeArrayStorage, RustRawLocationPlan } from "../../../../target-model/records/native-memory.js";
import { rustNativeMemoryLayoutsEqual } from "../../../../target-model/operations/native-memory.js";
import type { RustNativeMemoryLayout } from "../../../../target-model/operations/native-memory.js";

export const rustNativeArrayStorageKey = defineRustPlanKey<RustNativeArrayStorage>("nativeArrayStorage", (left, right) =>
  left.kind === right.kind && (left.kind !== "element" || right.kind === "element" && left.declaration === right.declaration) && left.stride === right.stride &&
  rustNativeMemoryLayoutsEqual(left.layout, right.layout));

export const rustNativeBackingKey = defineRustPlanKey<RustNativeMemoryLayout>("nativeBacking", rustNativeMemoryLayoutsEqual);

export const rustRawLocationPlanKey = defineRustPlanKey<RustRawLocationPlan>("rawLocation", (left, right) =>
  left.operation === right.operation && left.expression === right.expression &&
  rustTargetTypeRefEquals(left.inputCarrier, right.inputCarrier) && rustNativeMemoryLayoutsEqual(left.layout, right.layout));

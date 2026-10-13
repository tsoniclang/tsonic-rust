import { defineRustPlanKey } from "../key.js";

export const rustMemoryLayoutObservationKey = defineRustPlanKey<{ readonly value: number }>(
  "memoryLayoutObservation", (left, right) => left.value === right.value,
);

import { defineRustPlanKey } from "../facts/keys.js";

export const rustMemoryMetadataKey = defineRustPlanKey<true>("memoryMetadata", (left, right) => left === right);

export const rustMemoryLayoutObservationKey = defineRustPlanKey<{ readonly value: number }>(
  "memoryLayoutObservation", (left, right) => left.value === right.value,
);

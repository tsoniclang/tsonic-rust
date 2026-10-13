import { defineRustPlanKey } from "../key.js";

export const rustModuleCallableStorageFactKey = defineRustPlanKey<{ readonly kind: "inline" | "stored" }>(
  "moduleCallableStorage", (left, right) => left.kind === right.kind,
);

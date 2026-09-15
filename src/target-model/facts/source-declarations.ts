import { defineRustPlanKey } from "./keys.js";

export const rustCompileTimeSourceKey = defineRustPlanKey<true>(
  "compileTimeSource",
  (left, right) => left === right,
);

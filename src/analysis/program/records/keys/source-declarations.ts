import { defineRustPlanKey } from "../key.js";

export const rustCompileTimeSourceKey = defineRustPlanKey<true>(
  "compileTimeSource",
  (left, right) => left === right,
);

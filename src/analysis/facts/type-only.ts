import { defineRustPlanKey } from "../../target-model/facts/keys.js";

export const rustTypeOnlyDeclarationFactKey = defineRustPlanKey<{
  readonly reason: "ambient" | "type-family-predicate";
}>("typeOnlyDeclaration", (left, right) => left.reason === right.reason);

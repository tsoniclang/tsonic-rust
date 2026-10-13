import { defineRustPlanKey } from "../key.js";

export const rustTypeOnlyDeclarationFactKey = defineRustPlanKey<{
  readonly reason: "ambient" | "type-family-predicate" | "representation-alias";
}>("typeOnlyDeclaration", (left, right) => left.reason === right.reason);

import type { RustObjectLiteralEmissionPolicyInput } from "../../model/object-literal-emission.js";

export function selectRustObjectLiteralDispatch(input: RustObjectLiteralEmissionPolicyInput): "project" | "structural" | undefined {
  if (input.fact.storage !== "project-object") return input.structuralDispatch ? "structural" : undefined;
  return input.polymorphicProject || input.fact.contributions.some(contribution => contribution.kind === "method" ||
    contribution.kind === "accessor" || contribution.kind === "spread" && contribution.methods.length !== 0) ? "project" : undefined;
}

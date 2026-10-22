/**
 * A target-ast normalization received syntax its planner never produces. Target-ast imports only the target model, so
 * it cannot use the planner's failure owner; the planner translates this failure into its planning invariant at the
 * normalization boundary (planRustSyntaxNormalization in planner/diagnostics.ts).
 */
export class RustSyntaxInvariantFailure extends Error {}

export function failRustSyntaxInvariant(message: string): never {
  throw new RustSyntaxInvariantFailure(message);
}

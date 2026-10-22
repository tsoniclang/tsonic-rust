import type { Node } from "@tsonic/tsts";
import { failTargetPlannerInvariant } from "@tsonic/target-api/artifacts";
import { RustSyntaxInvariantFailure } from "../target-ast/syntax/invariants.js";

export function failRustPlannerInvariant(message: string, sourceNode?: Node): never {
  return failTargetPlannerInvariant("tsonic-rust", message, sourceNode);
}

/** Runs a target-ast normalization; its syntax invariant failures are planning invariant failures. */
export function planRustSyntaxNormalization<T>(normalize: () => T): T {
  try {
    return normalize();
  } catch (failure) {
    if (failure instanceof RustSyntaxInvariantFailure) failRustPlannerInvariant(failure.message);
    throw failure;
  }
}

import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import {
  maximumRustFoundation,
  rustFoundationIncludes,
  type RustFoundation,
} from "../../target-model/foundation/model.js";

export interface RustFoundationPlan {
  readonly selected: RustFoundation;
  readonly required: RustFoundation;
}

export function analyzeRustFoundation(options: {
  readonly selected: RustFoundation;
  readonly factRequirement: RustFoundation;
  readonly runtimeReferenceRequirement: RustFoundation;
  readonly moduleInitializationRequirement: RustFoundation;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly jsEnabled: boolean;
  readonly binaryOutput: boolean;
}): { readonly plan?: RustFoundationPlan; readonly diagnostics: readonly TargetDiagnostic[] } {
  let required = maximumRustFoundation(
    maximumRustFoundation(
      options.factRequirement,
      options.runtimeReferenceRequirement,
    ),
    options.moduleInitializationRequirement,
  );
  if (options.objectRepresentations.representations.some((representation) =>
    representation.kind !== "value")) {
    required = maximumRustFoundation(required, "alloc");
  }
  if (options.jsEnabled || options.binaryOutput) {
    required = "std";
  }
  if (!rustFoundationIncludes(options.selected, required)) {
    return Object.freeze({
      diagnostics: Object.freeze([{
        code: "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED",
        category: "error" as const,
        source: "tsonic-rust",
        message: `The checked program requires Rust '${required}', but the target selected '${options.selected}'.`,
        evidence: Object.freeze([
          "target.capability=rust.foundation",
          `rust.foundation.selected=${options.selected}`,
          `rust.foundation.required=${required}`,
        ]),
      }]),
    });
  }
  return Object.freeze({
    plan: Object.freeze({ selected: options.selected, required }),
    diagnostics: Object.freeze([]),
  });
}

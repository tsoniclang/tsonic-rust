import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustFoundationPlan } from "./plan.js";
import { maximumRustFoundation, rustFoundationIncludes, type RustFoundation } from "../../target-model/foundation/model.js";

export function finalizeRustFoundation(plan: RustFoundationPlan, records: RustFoundation):
  { readonly plan: RustFoundationPlan; readonly diagnostics: readonly TargetDiagnostic[] } {
  const required = maximumRustFoundation(plan.required, records);
  const diagnostics: readonly TargetDiagnostic[] = rustFoundationIncludes(plan.selected, required) ? [] : [{
    code: "RUST_FOUNDATION_REQUIREMENT_UNSATISFIED", category: "error", source: "tsonic-rust",
    message: `The checked program requires Rust '${required}', but the target selected '${plan.selected}'.`,
    evidence: Object.freeze(["target.capability=rust.foundation", `rust.foundation.selected=${plan.selected}`, `rust.foundation.required=${required}`]),
  }];
  return Object.freeze({ plan: Object.freeze({ selected: plan.selected, required }), diagnostics: Object.freeze(diagnostics) });
}

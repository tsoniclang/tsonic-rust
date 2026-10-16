import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export function analyzeRustComputedFieldNames(source: TargetSourceProgram): readonly TargetDiagnostic[] {
  return Object.freeze(source.navigation.sourceFiles.flatMap(sourceFile =>
    source.semantics.forFile(sourceFile).propertyNames.issues.map(issue => Object.freeze({
    code: issue.failure === "resource" ? "RUST_ENUM_CONSTANT_RESOURCE_LIMIT" : "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN",
    category: "error" as const,
    source: "tsonic-rust",
    sourceNode: issue.node,
    message: issue.reason,
  }))));
}

import type { Node, SourceFile } from "@tsonic/tsts";
import type { SourceBinaryEntryIssue } from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustFoundation } from "../foundation/model.js";

export type RustModuleInitializationRequirement =
  | { readonly kind: "required" }
  | { readonly kind: "not-required" }
  | { readonly kind: "unresolved"; readonly node: Node; readonly reason: string };

/** A top-level statement whose kind the Rust target cannot lower fails closed before module initialization is selected. */
export interface RustUnsupportedTopLevelStatementIssue {
  readonly code: "RUST_UNSUPPORTED_AST";
  readonly node: Node;
  readonly message: string;
  readonly evidence: readonly string[];
}

export type RustModuleInitializationIssue = SourceBinaryEntryIssue | RustUnsupportedTopLevelStatementIssue;

export interface RustModuleCycleSelection {
  readonly sourceFiles: readonly SourceFile[];
  readonly issue: TargetDiagnostic & { readonly evidence: readonly string[] };
}

export interface RustModuleInitializationPlan {
  readonly issues: readonly RustModuleInitializationIssue[];
  readonly moduleCycles: readonly RustModuleCycleSelection[];
  requirementFor(sourceFile: SourceFile): RustModuleInitializationRequirement;
  minimumFoundation(): RustFoundation;
}

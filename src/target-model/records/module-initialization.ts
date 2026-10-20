import type { Node, SourceFile } from "@tsonic/tsts";
import type { SourceBinaryEntryIssue } from "@tsonic/target-api/analysis";
import type { RustFoundation } from "../foundation/model.js";

export type RustModuleInitializationRequirement =
  | { readonly kind: "required" }
  | { readonly kind: "not-required" }
  | { readonly kind: "unresolved"; readonly node: Node; readonly reason: string };

export interface RustModuleInitializationPlan {
  readonly issues: readonly SourceBinaryEntryIssue[];
  requirementFor(sourceFile: SourceFile): RustModuleInitializationRequirement;
  minimumFoundation(): RustFoundation;
  hasStateIndependentCycle(sourceFile: SourceFile): boolean;
}

import type {
  AstReader,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustNamePlan } from "../../policy/names/model.js";
import type { RustPlanQueries } from "../../policy/model/selections.js";
import type { RustProviderSemantics } from "../../providers/packages/model.js";
import type { RustSourceCallableSpecializationPlan } from "../callables/specializations.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import type { RustProjectMethodDispatchPlan } from "../project-types/method-dispatch.js";
import type { RustProjectMethodPropertyPlan } from "../project-types/method-properties.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustStructuralShapePlan } from "../objects/structural-shape-plan.js";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";

export interface RustTargetAnalysisQueries {
  getEnumMemberConstant(node: Node): { readonly value: string | number } | undefined;
}

export interface RustTargetProgram {
  readonly source: TargetSourceProgram;
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly projectMethodProperties: RustProjectMethodPropertyPlan;
  readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlan;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly providerSemantics: RustProviderSemantics;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly names: RustNamePlan;
  readonly analysis: RustTargetAnalysisQueries;
  semantics(sourceFile: SourceFile): SourceFileSemantics;
  semanticsFor(node: Node): SourceFileSemantics;
}

export type AnalyzeRustTargetProgramResult =
  | { readonly kind: "resolved"; readonly program: RustTargetProgram }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] };

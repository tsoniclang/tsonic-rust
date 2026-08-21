import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
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
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustModuleInitializationPlan } from "./module-initialization-facts.js";
import type { RustTargetConfiguration } from "../../target-model/configuration/model.js";

export interface RustTargetAnalysisRequest {
  readonly input: TargetCompileInput;
  readonly configuration: RustTargetConfiguration;
  readonly providerSemantics: RustProviderSemantics;
  readonly jsEnabled: boolean;
  readonly rootPublishesLibrary: boolean;
}

export interface RustTargetAnalysisQueries {
  getEnumMemberConstant(node: Node): { readonly value: string | number } | undefined;
}

export interface RustTargetProgram {
  readonly configuration: RustTargetConfiguration;
  readonly source: TargetSourceProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly projectMethodProperties: RustProjectMethodPropertyPlan;
  readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlan;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly providerSemantics: RustProviderSemantics;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly moduleInitialization: RustModuleInitializationPlan;
  readonly names: RustNamePlan;
  readonly analysis: RustTargetAnalysisQueries;
}

export type AnalyzeRustTargetProgramResult = TargetStageResult<RustTargetProgram>;

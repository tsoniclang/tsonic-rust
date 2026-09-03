import type { SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type {
  TargetPlanningSourceNavigation,
  TargetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustSourceCallableSpecializationPlan } from "../callables/specializations.js";
import type { RustCallableGenericRequirementIndex } from "../callables/generic-requirements.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import type { RustProjectMethodDispatchPlan } from "../project-types/method-dispatch.js";
import type { RustProjectMethodPropertyPlan } from "../project-types/method-properties.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustStructuralShapePlan } from "../objects/structural-shape-plan.js";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustModuleInitializationPlan } from "./module-initialization-facts.js";
import type { RustTargetConfiguration } from "../../target-model/configuration/model.js";
import type { RustValueLifetimePlan } from "./value-lifetimes.js";
import type { RustRuntimeReferencePlan } from "../runtime/index.js";
import type { RustBinaryEpiloguePlan } from "../runtime/index.js";
import type {
  RustEnumMemberConstantIndex,
} from "../declarations/enum-member-constants.js";
import type {
  RustSourcePackageFacadeClassifications,
} from "./source-package-facades.js";
import type {
  RustSourcePackageComponentClassifications,
} from "./source-package-components.js";
import type {
  RustCountedLoopRepresentationPlan,
} from "../control-flow/counted-loop-representations.js";
import type {
  RustProviderSemantics,
} from "../../providers/packages/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustSourceModuleConstructionIndex } from "../source-modules/index.js";
import type { RustFoundationPlan } from "../foundation/plan.js";
import type { RustProjectFlowReadSelectionIndex } from "../control-flow/project-flow-read-selections.js";
import type { RustGeneratedDeclarationUse } from "./generated-declaration-uses.js";

export interface RustTargetAnalysisRequest {
  readonly input: TargetCompileInput;
  readonly configuration: RustTargetConfiguration;
  readonly providerSemantics: RustProviderSemantics;
  readonly jsEnabled: boolean;
  readonly rootPublishesLibrary: boolean;
}

export interface RustPlanningHost {
  readonly paths: TargetCompileInput["paths"];
  readonly entryPoint: string;
  readonly sourcePackages: TargetCompileInput["sourcePackages"];
}

export interface RustTargetProgram {
  readonly host: RustPlanningHost;
  readonly configuration: RustTargetConfiguration;
  readonly source: TargetSourceSyntaxProgram;
  readonly sourceNavigation: TargetPlanningSourceNavigation;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly projectMethodProperties: RustProjectMethodPropertyPlan;
  readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlan;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly callableGenericRequirements: RustCallableGenericRequirementIndex;
  readonly valueLifetimes: RustValueLifetimePlan;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly runtimeReferences: RustRuntimeReferencePlan;
  readonly foundation: RustFoundationPlan;
  readonly binaryEpilogues: readonly RustBinaryEpiloguePlan[];
  readonly providerErrorCarriers: readonly import("../../target-model/types/model.js").TargetTypeRef[];
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly moduleInitialization: RustModuleInitializationPlan;
  readonly names: RustNamePlan;
  readonly enumMemberConstants: RustEnumMemberConstantIndex;
  readonly sourcePackageFacades: RustSourcePackageFacadeClassifications;
  readonly sourcePackageComponents: RustSourcePackageComponentClassifications;
  readonly countedLoops: RustCountedLoopRepresentationPlan;
  readonly projectFlowReadSelections: RustProjectFlowReadSelectionIndex;
  readonly sourceModuleConstructions: RustSourceModuleConstructionIndex;
  readonly generatedDeclarationUses: readonly RustGeneratedDeclarationUse[];
}

export type AnalyzeRustTargetProgramResult = TargetStageResult<RustTargetProgram>;

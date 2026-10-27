import type { RustTargetProgram } from "../../target-model/records/target-program.js";
import type { SourceFile } from "@tsonic/tsts";
import type { SourceLiteralIndex } from "@tsonic/target-api/source";
import type { RustNumericRepresentations } from "../../target-model/records/operations/numeric.js";
import type { TargetCompileInput } from "@tsonic/target-api";
import type { TargetPlanningSourceNavigation, TargetSourceSyntaxProgram } from "@tsonic/target-api/analysis";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustSourceFileOutputIdentity } from "../../target-model/names/source-output-identities.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustSourceCallableSpecializationPlan } from "../callables/generics/specializations.js";
import type { RustCallableValuePlan } from "../callables/values/value-plan.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import type { RustProjectMethodDispatchPlan } from "../project-types/method-dispatch.js";
import type { RustProjectMethodPropertyPlan } from "../project-types/method-properties.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustModuleInitializationPlan } from "../../target-model/records/program/module-initialization.js";
import type { RustTargetConfiguration } from "../../target-model/configuration/model.js";
import type { RustRuntimeReferencePlan } from "../project/index.js";
import type { RustBinaryHookPlan } from "../project/index.js";
import type { RustSourcePackageFacadeClassifications } from "../../target-model/records/program/source-package-semantics.js";
import type { RustSourcePackageComponentClassifications } from "../../target-model/records/program/source-package-semantics.js";
import type { RustProviderSemantics } from "../../target-model/metadata/provider-metadata.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustSourceModuleConstructionIndex } from "../../target-model/records/program/source-modules.js";
import type { RustFoundationPlan } from "../foundation/plan.js";
import type { RustProjectFlowReadSelectionIndex } from "../control-flow/project-flow-read-selections.js";
import type { RustGeneratedDeclarationUse } from "../../target-model/records/program/generated-declaration-uses.js";
import type { RustSourceTypeFamilyPlan } from "../../target-model/types/type-families.js";
import type { RustLocalStorageAliasPlan } from "../storage/local-aliases.js";
import type { RustProjectConstructionQueries } from "../project-types/construction-plan.js";

export interface RustTargetAnalysisRequest {
  readonly input: TargetCompileInput;
  readonly runtimeCrates: import("../../providers/model/runtime-crates.js").RustRuntimeCrateAcquisitions;
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

export interface RustAnalysisProgram {
  readonly physicalEmissionContexts: import("../../target-model/records/native/physical-emission-contexts.js").RustCallableEmissionContexts;
  readonly reachability: import("../../target-model/records/program/reachability.js").RustReachability;
  readonly errorRegions: import("../../target-model/records/errors/error-regions.js").RustErrorRegionRecords;
  readonly callableOwnership: import("../callables/ownership/ownership-plan.js").RustCallableOwnershipPlan;
  readonly lexicalFunctions: import("../../target-model/records/callables/lexical-functions.js").RustLexicalFunctionQueries;
  readonly errorStorageDemands: import("@tsonic/target-api/analysis").SourceErrorStorageDemandQueries;
  readonly localStorageAliases: RustLocalStorageAliasPlan;
  readonly promiseBodies: import("../../target-model/records/callables/callables-and-resources.js").RustPromiseBodies;
  readonly promiseResults: import("../../target-model/records/callables/promise-results.js").RustPromiseResults;
  readonly numericRepresentations: RustNumericRepresentations;
  readonly typeDefinitions: import("../../target-model/types/source-union-definitions.js").RustTypeDefinitions;
  readonly typeFamilies: RustSourceTypeFamilyPlan;
  readonly host: RustPlanningHost;
  readonly configuration: RustTargetConfiguration;
  readonly source: TargetSourceSyntaxProgram;
  readonly sourceNavigation: TargetPlanningSourceNavigation;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourceOutputIdentities: ReadonlyMap<string, RustSourceFileOutputIdentity>;
  readonly records: RustProgramRecords & SourceLiteralIndex;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly projectConstructions: RustProjectConstructionQueries;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly projectMethodProperties: RustProjectMethodPropertyPlan;
  readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlan;
  readonly callableValues: RustCallableValuePlan;
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly declarationGenericRequirements: RustDeclarationGenericRequirementIndex;
  readonly ownership: import("../../target-model/records/storage/ownership.js").RustOwnershipRecords;
  readonly retainedCallableInputs: import("../../target-model/records/callables/retained-inputs.js").RustRetainedCallableInputPlan;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly frozenDataWrites: import("../../target-model/records/storage/frozen-data.js").RustFrozenDataWritePlan;
  readonly classValues: import("../../target-model/records/objects/class-values.js").RustClassValuePlan;
  readonly runtimeReferences: RustRuntimeReferencePlan;
  readonly dispatchContexts: import("../project/dispatch-contexts.js").RustDispatchContextDeclarations;
  readonly dispatchContextDemand: import("../project/dispatch-demand.js").RustDispatchContextDemandPlan;
  readonly binaryDispatchDemand: import("../project/binary-dispatch-demand.js").RustBinaryDispatchDemandPlan;
  readonly foundation: RustFoundationPlan;
  readonly binaryHooks: readonly RustBinaryHookPlan[];
  readonly binaryExecution: import("../../target-model/records/operations/binary-execution.js").RustBinaryExecution;
  readonly providerErrorCarriers: readonly import("../../target-model/types/model.js").TargetTypeRef[];
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly moduleInitialization: RustModuleInitializationPlan;
  readonly names: RustNamePlan;
  readonly sourcePackageFacades: RustSourcePackageFacadeClassifications;
  readonly sourcePackageComponents: RustSourcePackageComponentClassifications;
  readonly errorTransport: import("../../target-model/records/errors/error-transport.js").RustErrorTransportQueries;
  readonly projectFlowReadSelections: RustProjectFlowReadSelectionIndex;
  readonly sourceModuleConstructions: RustSourceModuleConstructionIndex;
  readonly generatedDeclarationUses: readonly RustGeneratedDeclarationUse[];
  readonly borrowedElementReads: import("../storage/borrowed-element-reads.js").RustBorrowedElementReads;
  readonly genericCallableErrors: import("../../target-model/records/callables/generic-callable-errors.js").RustGenericCallableErrorIndex;
}

/** The analysis program after native emission finalization, which also publishes the native declaration forms. */
export interface RustCompleteAnalysisProgram extends RustAnalysisProgram {
  readonly nativeDeclarations: import("../../target-model/records/native/native-declaration-forms.js").RustNativeDeclarationForms;
}

export type AnalyzeRustTargetProgramResult = TargetStageResult<RustTargetProgram>;

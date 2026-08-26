import {
  rejectedTargetStage,
  resolvedTargetStage,
} from "@tsonic/target-api/artifacts";
import {
  snapshotTargetPlanningSourceNavigation,
  targetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import { analyzeRustProgram } from "./analyze.js";
import { createRustAnalysisContext } from "./context.js";
import type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";
import { createRustModuleInitializationPlan } from "./module-initialization-facts.js";
import { analyzeRustProviderErrorCarriers } from "./provider-errors.js";
import { analyzeRustCallableGenericRequirements } from "../callables/generic-requirements.js";
import { analyzeRustOwnership } from "../ownership/index.js";
import {
  analyzeRustBinaryEpilogues,
  analyzeRustRuntimeReferences,
} from "../runtime/index.js";
import {
  analyzeRustEnumMemberConstants,
} from "../declarations/enum-member-constants.js";
import {
  analyzeRustSourcePackageFacades,
} from "./source-package-facades.js";
import {
  analyzeRustSourcePackageComponents,
} from "./source-package-components.js";
import {
  analyzeRustCountedLoopRepresentations,
} from "../control-flow/counted-loop-representations.js";

export function analyzeRustTargetProgram(
  request: RustTargetAnalysisRequest,
): AnalyzeRustTargetProgramResult {
  const {
    input,
    configuration,
    providerSemantics,
    jsEnabled,
    rootPublishesLibrary,
  } = request;
  const runtimeReferences = analyzeRustRuntimeReferences(
    input.runtimeReferences,
  );
  if (runtimeReferences.kind === "rejected") {
    return rejectedTargetStage(runtimeReferences.diagnostics);
  }
  const binaryEpilogues = analyzeRustBinaryEpilogues(
    providerSemantics.binaryEpilogues,
    runtimeReferences.plan.activeCrates,
  );
  const context = createRustAnalysisContext(
    input,
    providerSemantics,
    jsEnabled,
    rootPublishesLibrary,
  );
  const declarationContracts = analyzeRustProgram(context, configuration.dialect);
  if (context.diagnostics.length > 0 || declarationContracts === undefined) {
    return rejectedTargetStage(context.diagnostics);
  }

  const sourcePackageFacades = analyzeRustSourcePackageFacades(context);
  if (sourcePackageFacades.kind === "rejected") {
    return rejectedTargetStage(sourcePackageFacades.diagnostics);
  }
  const sourcePackageComponents = analyzeRustSourcePackageComponents(
    context,
    configuration.outputType,
  );
  if (sourcePackageComponents.kind === "rejected") {
    return rejectedTargetStage(sourcePackageComponents.diagnostics);
  }

  const moduleInitialization = createRustModuleInitializationPlan(context);
  const facts = context.facts.seal();
  const projectTypes = context.projectTypes.seal();
  const sourceGenerics = context.sourceGenerics.seal();
  const sourceObjectRepresentations = context.objectRepresentations.seal();
  const structuralShapes = context.structuralShapes.seal();
  const projectFieldDispatch = context.projectFieldDispatch.seal();
  const ownership = analyzeRustOwnership({
    ast: context.ast,
    sourceFiles: context.sourceFiles,
    navigation: context.source.navigation,
    facts,
    sourceGenerics,
    providerTypes: providerSemantics.types,
    projectTypes,
    objectRepresentations: sourceObjectRepresentations,
    structuralShapes,
    projectFieldDispatch,
    declarationContracts,
    traits: context.traits,
  });
  if (ownership.kind === "rejected") {
    return rejectedTargetStage(ownership.diagnostics);
  }
  const callableGenericRequirements = analyzeRustCallableGenericRequirements(
    context.source,
    context.sourceFiles,
    facts,
    context.sourceGenerics,
    ownership.analysis,
    context.traits,
  );
  if (callableGenericRequirements.kind === "rejected") {
    return rejectedTargetStage(callableGenericRequirements.diagnostics);
  }
  const program: RustTargetProgram = Object.freeze({
    host: Object.freeze({
      paths: Object.freeze({ ...input.paths }),
      entryPoint: input.project.entryPoint,
      sourcePackages: input.sourcePackages,
    }),
    configuration,
    source: targetSourceSyntaxProgram(context.source),
    sourceNavigation: snapshotTargetPlanningSourceNavigation(context.source),
    sourceFiles: context.sourceFiles,
    facts,
    projectTypes,
    objectRepresentations: sourceObjectRepresentations,
    projectMethodDispatch: context.projectMethodDispatch.seal(),
    projectMethodProperties: context.projectMethodProperties.seal(),
    projectFieldDispatch,
    sourceCallableSpecializations: context.sourceCallableSpecializations.seal(),
    sourceGenerics,
    declarationContracts,
    callableGenericRequirements: callableGenericRequirements.index,
    ownership: ownership.analysis,
    structuralShapes,
    runtimeReferences: runtimeReferences.plan,
    binaryEpilogues,
    providerErrorCarriers: analyzeRustProviderErrorCarriers(
      context.ast,
      context.sourceFiles,
      facts,
      binaryEpilogues,
    ),
    safetyApplications: context.safetyApplications,
    moduleInitialization,
    names: context.names,
    enumMemberConstants: analyzeRustEnumMemberConstants(
      context.source,
      context.sourceFiles,
    ),
    sourcePackageFacades: sourcePackageFacades.plan,
    sourcePackageComponents: sourcePackageComponents.plan,
    countedLoops: analyzeRustCountedLoopRepresentations({
      ast: context.ast,
      sourceFiles: context.sourceFiles,
      navigation: context.source.navigation,
      facts,
    }),
  });
  return resolvedTargetStage(program);
}

export type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";

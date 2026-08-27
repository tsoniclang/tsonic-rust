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
import { analyzeRustValueLifetimes } from "./value-lifetimes.js";
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
  analyzeRustProgram(context);
  if (context.diagnostics.length > 0) {
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
  const callableGenericRequirements = analyzeRustCallableGenericRequirements(
    context.source,
    context.sourceFiles,
    facts,
    context.names,
    context.sourceLifetimes,
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
    projectTypes: context.projectTypes.seal(),
    objectRepresentations: context.objectRepresentations.seal(),
    projectMethodDispatch: context.projectMethodDispatch.seal(),
    projectMethodProperties: context.projectMethodProperties.seal(),
    projectFieldDispatch: context.projectFieldDispatch.seal(),
    sourceCallableSpecializations: context.sourceCallableSpecializations.seal(),
    sourceLifetimes: context.sourceLifetimes,
    callableGenericRequirements: callableGenericRequirements.index,
    valueLifetimes: analyzeRustValueLifetimes({
      ast: context.ast,
      sourceFiles: context.sourceFiles,
      navigation: context.source.navigation,
    }),
    structuralShapes: context.structuralShapes.seal(),
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

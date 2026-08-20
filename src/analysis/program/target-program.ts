import {
  rejectedTargetStage,
  resolvedTargetStage,
} from "@tsonic/target-api/artifacts";
import { analyzeRustProgram } from "./analyze.js";
import { createRustAnalysisContext } from "./context.js";
import type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";
import { createRustModuleInitializationPlan } from "./module-initialization-facts.js";

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

  const moduleInitialization = createRustModuleInitializationPlan(context);
  const program: RustTargetProgram = Object.freeze({
    configuration,
    source: context.source,
    sourceFiles: context.sourceFiles,
    facts: context.facts.seal(),
    projectTypes: context.projectTypes.seal(),
    objectRepresentations: context.objectRepresentations.seal(),
    projectMethodDispatch: context.projectMethodDispatch.seal(),
    projectMethodProperties: context.projectMethodProperties.seal(),
    projectFieldDispatch: context.projectFieldDispatch.seal(),
    sourceCallableSpecializations: context.sourceCallableSpecializations.seal(),
    structuralShapes: context.structuralShapes.seal(),
    providerSemantics: context.providerSemantics,
    safetyApplications: context.safetyApplications,
    moduleInitialization,
    names: context.names,
    analysis: context.analysis,
  });
  return resolvedTargetStage(program);
}

export type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";

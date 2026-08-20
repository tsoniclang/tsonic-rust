import type {
  TargetBackendContext,
  TargetCompileInput,
} from "@tsonic/target-api";
import type { RustProviderSemantics } from "../../providers/packages/model.js";
import { analyzeRustProgram } from "./analyze.js";
import { createRustAnalysisContext } from "./context.js";
import type {
  AnalyzeRustTargetProgramResult,
  RustTargetProgram,
} from "./model.js";
import { createRustModuleInitializationPlan } from "./module-initialization-facts.js";

export function analyzeRustTargetProgram(
  backend: TargetBackendContext,
  input: TargetCompileInput,
  providerSemantics: RustProviderSemantics,
  jsEnabled: boolean,
  rootPublishesLibrary: boolean,
): AnalyzeRustTargetProgramResult {
  const context = createRustAnalysisContext(
    backend,
    input,
    providerSemantics,
    jsEnabled,
    rootPublishesLibrary,
  );
  analyzeRustProgram(context);
  if (context.diagnostics.length > 0) {
    return {
      kind: "rejected",
      diagnostics: Object.freeze([...context.diagnostics]),
    };
  }

  const moduleInitialization = createRustModuleInitializationPlan(context);
  const program: RustTargetProgram = Object.freeze({
    source: context.source,
    ast: context.ast,
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
    semantics: context.semantics,
    semanticsFor: context.semanticsFor,
  });
  return { kind: "resolved", program };
}

export type {
  AnalyzeRustTargetProgramResult,
  RustTargetProgram,
} from "./model.js";

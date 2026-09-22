import {
  rejectedTargetStage,
  resolvedTargetStage,
} from "@tsonic/target-api/artifacts";
import {
  snapshotTargetPlanningSourceNavigation,
  targetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import { analyzeRustProgram } from "./analyze.js";
import { analyzeRustNumericRepresentations } from "../numeric/representations.js";
import { createRustAnalysisContext } from "./context.js";
import type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";
import { createRustModuleInitializationPlan } from "../module-initialization/analyze.js";
import { analyzeRustProviderErrorCarriers } from "./provider-errors.js";
import { analyzeRustDeclarationGenericRequirements } from "../declarations/generic-requirements.js";
import { analyzeRustValueLifetimes } from "./value-lifetimes.js";
import { analyzeRustBorrowedElementReads } from "./borrowed-element-reads.js";
import {
  analyzeRustBinaryHooks,
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
import type { RustProviderBinaryHookRow } from "../../providers/packages/model.js";
import { analyzeRustSourceModuleConstructions } from "../source-modules/index.js";
import { analyzeRustFoundation } from "../foundation/plan.js";
import { rustFoundationForCarrier } from "../foundation/requirements.js";
import { maximumRustFoundation } from "../../target-model/foundation/model.js";
import { analyzeRustProjectFlowReadSelections } from "../control-flow/project-flow-read-selections.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { rustClosureCaptureFactKey } from "../facts/keys.js";

const rustJsTimerEpilogue: RustProviderBinaryHookRow = Object.freeze({
  id: "tsonic.rust.js.timers",
  phase: "after-entry",
  path: "tsonic_rust_js::abi::run_timers",
  requiredCrate: "tsonic_rust_js",
  isFallible: true,
  errorBoundary: "target-runtime",
  providerPackageId: "tsonic.rust.js-surface",
  providerVersion: "1",
});

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
    configuration.foundation,
  );
  if (runtimeReferences.kind === "rejected") {
    return rejectedTargetStage(runtimeReferences.diagnostics);
  }
  const binaryHooks = analyzeRustBinaryHooks(
    jsEnabled
      ? [...providerSemantics.binaryHooks, rustJsTimerEpilogue]
      : providerSemantics.binaryHooks,
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

  const classValues = context.classValues.seal(context);
  const moduleInitialization = createRustModuleInitializationPlan(context, classValues);
  const objectRepresentations = context.objectRepresentations.seal();
  const foundation = analyzeRustFoundation({
    selected: configuration.foundation,
    factRequirement: context.typeDefinitions.definitionCarriers().map(rustFoundationForCarrier)
      .reduce(maximumRustFoundation, context.facts.minimumFoundation()),
    runtimeReferenceRequirement: [...runtimeReferences.plan.minimumFoundationByCrate.values()]
      .reduce(maximumRustFoundation, "core"),
    moduleInitializationRequirement: moduleInitialization.minimumFoundation(),
    objectRepresentations,
    jsEnabled,
    binaryOutput: configuration.outputType === "bin",
  });
  if (foundation.plan === undefined) {
    return rejectedTargetStage(foundation.diagnostics);
  }
  const facts = context.facts.seal();
  const valueLifetimes = analyzeRustValueLifetimes({
    ast: context.ast,
    sourceFiles: context.sourceFiles,
    navigation: context.source.navigation,
    isOwnedString: (declaration) => isRustStringCarrier(facts.getRuntimeCarrierFact(declaration)?.carrier),
    mayBorrowArgument: (argument) => facts.getArgumentPassingFact(argument)?.mode !== "by-value",
    capturesFor: (closure) => facts.getFact(closure, rustClosureCaptureFactKey),
  });
  const declarationGenericRequirements = analyzeRustDeclarationGenericRequirements(
    context.source,
    context.sourceFiles,
    facts,
    context.names,
    context.sourceLifetimes,
    context.typeFamilies,
    context.projectTypes,
    context.structuralShapes,
    context.typeDefinitions,
    valueLifetimes,
    objectRepresentations,
  );
  if (declarationGenericRequirements.kind === "rejected") {
    return rejectedTargetStage(declarationGenericRequirements.diagnostics);
  }
  const sourceModuleConstructions = analyzeRustSourceModuleConstructions({
    source: context.source,
    sourceFiles: context.sourceFiles,
    facts,
    outputType: configuration.outputType,
  });
  if (sourceModuleConstructions.issues.length > 0) {
    return rejectedTargetStage(sourceModuleConstructions.issues.map((issue) => ({
      code: issue.code,
      category: "error" as const,
      source: "tsonic-rust",
      message: issue.message,
      sourceNode: issue.node,
      evidence: ["target.capability=rust.backend.source-module-construction"],
    })));
  }
  const program: RustTargetProgram = Object.freeze({
    numericRepresentations: analyzeRustNumericRepresentations({ source: context.source,
      sourceFiles: context.sourceFiles, facts }),
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
    typeFamilies: context.typeFamilies.seal(),
    typeDefinitions: context.typeDefinitions.seal(),
    projectTypes: context.projectTypes.seal(),
    objectRepresentations,
    projectMethodDispatch: context.projectMethodDispatch.seal(),
    projectMethodProperties: context.projectMethodProperties.seal(),
    projectFieldDispatch: context.projectFieldDispatch.seal(),
    sourceCallableSpecializations: context.sourceCallableSpecializations.seal(),
    sourceLifetimes: context.sourceLifetimes,
    declarationGenericRequirements: declarationGenericRequirements.index,
    valueLifetimes,
    borrowedElementReads: analyzeRustBorrowedElementReads(context.ast, context.sourceFiles, facts, context.source.navigation),
    structuralShapes: context.structuralShapes.seal(),
    frozenDataWrites: context.frozenDataWrites.seal(),
    classValues,
    runtimeReferences: runtimeReferences.plan,
    foundation: foundation.plan,
    binaryHooks,
    providerErrorCarriers: analyzeRustProviderErrorCarriers(
      context.ast,
      context.sourceFiles,
      facts,
      binaryHooks,
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
    projectFlowReadSelections: analyzeRustProjectFlowReadSelections({
      ast: context.ast,
      sourceFiles: context.sourceFiles,
      facts,
    }),
    sourceModuleConstructions: sourceModuleConstructions.index,
    generatedDeclarationUses: context.generatedDeclarationUses.seal(),
  });
  return resolvedTargetStage(program);
}

export type {
  AnalyzeRustTargetProgramResult,
  RustTargetAnalysisRequest,
  RustTargetProgram,
} from "./model.js";

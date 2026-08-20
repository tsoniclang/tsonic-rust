import type {
  AstReader,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type {
  TargetBackendContext,
  TargetCompileInput,
  TargetSelection,
} from "@tsonic/target-api";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustSourcePolicyContext } from "../../policy/model/context.js";
import { isDenseDataArray } from "../../policy/model/closed-data.js";
import type { RustProviderSemantics } from "../../providers/packages/model.js";
import {
  createRustNamePlan,
} from "../names/plan.js";
import type { RustNamePlan } from "../../policy/names/model.js";
import {
  createRustPlanBuilder,
} from "../facts/plan-store.js";
import type { RustPlanBuilder } from "../facts/plan-store.js";
import {
  createRustProjectTypePolicyRegistry,
} from "../project-types/type-policy.js";
import type { RustProjectTypePolicyRegistry } from "../project-types/type-policy.js";
import {
  createRustProjectMethodDispatchPlanRegistry,
} from "../project-types/method-dispatch.js";
import type { RustProjectMethodDispatchPlanRegistry } from "../project-types/method-dispatch.js";
import {
  createRustProjectMethodPropertyPlanRegistry,
} from "../project-types/method-properties.js";
import type { RustProjectMethodPropertyPlanRegistry } from "../project-types/method-properties.js";
import {
  createRustProjectFieldDispatchPlanRegistry,
} from "../project-types/field-dispatch.js";
import type { RustProjectFieldDispatchPlanRegistry } from "../project-types/field-dispatch.js";
import {
  createRustSourceCallableSpecializationPlanRegistry,
} from "../callables/specializations.js";
import type { RustSourceCallableSpecializationPlanRegistry } from "../callables/specializations.js";
import {
  createRustStructuralShapePlanRegistry,
} from "../objects/structural-shape-plan.js";
import type { RustStructuralShapePlanRegistry } from "../objects/structural-shape-plan.js";
import {
  createRustSafetyApplicationFactIndex,
} from "../safety/application-index.js";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import type { RustTargetAnalysisQueries } from "./model.js";
import {
  createRustObjectRepresentationPlanRegistry,
  type RustObjectRepresentationPlanRegistry,
} from "../project-types/object-representation.js";
import {
  createRustRuntimeValueUsePlan,
  type RustRuntimeValueUsePlan,
} from "./runtime-value-uses.js";

export interface RustAnalysisContext extends RustSourcePolicyContext {
  readonly backend: TargetBackendContext;
  readonly target: TargetSelection;
  readonly jsEnabled: boolean;
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourcePackages: TargetCompileInput["sourcePackages"];
  readonly rootPublishesLibrary: boolean;
  readonly facts: RustPlanBuilder;
  readonly projectTypes: RustProjectTypePolicyRegistry;
  readonly objectRepresentations: RustObjectRepresentationPlanRegistry;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlanRegistry;
  readonly projectMethodProperties: RustProjectMethodPropertyPlanRegistry;
  readonly projectFieldDispatch: RustProjectFieldDispatchPlanRegistry;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlanRegistry;
  readonly structuralShapes: RustStructuralShapePlanRegistry;
  readonly providerSemantics: RustProviderSemantics;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly runtimeValueUses: RustRuntimeValueUsePlan;
  readonly names: RustNamePlan;
  readonly diagnostics: TargetDiagnostic[];
  readonly analysis: RustTargetAnalysisQueries;
  semantics(sourceFile: SourceFile): SourceFileSemantics;
  semanticsFor(node: Node): SourceFileSemantics;
}

export function createRustAnalysisContext(
  backend: TargetBackendContext,
  input: TargetCompileInput,
  providerSemantics: RustProviderSemantics,
  jsEnabled: boolean,
  rootPublishesLibrary: boolean,
): RustAnalysisContext {
  const ast = input.source.ast;
  const rawSourceFiles: readonly (SourceFile | undefined)[] = input.source.sourceFiles;
  const sourceFiles = Object.freeze(
    isDenseDataArray(rawSourceFiles) && rawSourceFiles.every((sourceFile) => sourceFile !== undefined)
      ? rawSourceFiles.filter((sourceFile): sourceFile is SourceFile =>
          sourceFile !== undefined && !ast.isDeclarationFile(sourceFile))
      : [],
  );
  const safetyApplications = createRustSafetyApplicationFactIndex({
    ast,
    sourceFiles,
    sourceFacts: input.source.sourceFacts,
    navigation: input.source.navigation,
  });
  const runtimeValueUses = createRustRuntimeValueUsePlan({
    ast,
    navigation: input.source.navigation,
    safetyApplications,
  });
  return Object.freeze({
    source: input.source,
    backend,
    target: input.target,
    jsEnabled,
    ast,
    sourceFiles,
    sourcePackages: input.sourcePackages,
    rootPublishesLibrary,
    facts: createRustPlanBuilder(input.source.sourceFacts),
    projectTypes: createRustProjectTypePolicyRegistry(),
    objectRepresentations: createRustObjectRepresentationPlanRegistry(),
    projectMethodDispatch: createRustProjectMethodDispatchPlanRegistry(),
    projectMethodProperties: createRustProjectMethodPropertyPlanRegistry(),
    projectFieldDispatch: createRustProjectFieldDispatchPlanRegistry(),
    sourceCallableSpecializations: createRustSourceCallableSpecializationPlanRegistry(),
    structuralShapes: createRustStructuralShapePlanRegistry(),
    providerSemantics,
    safetyApplications,
    runtimeValueUses,
    names: createRustNamePlan({
      ast,
      navigation: input.source.navigation,
      runtimeValueUses,
      sourceFiles,
    }),
    diagnostics: [],
    analysis: Object.freeze({
      getEnumMemberConstant(node: Node) {
        const value = input.source.semantics.forNode(node).getConstantValue(node);
        return typeof value === "number" || typeof value === "string"
          ? { value }
          : undefined;
      },
    }),
    semantics: input.source.semantics.forFile,
    semanticsFor: input.source.semantics.forNode,
  });
}

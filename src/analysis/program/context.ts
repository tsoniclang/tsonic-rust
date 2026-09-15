import { createTsonicMemoryBindingIndex, createTsonicMemoryMetadataIndex, type TsonicMemoryMetadataIndex,
  createTsonicPointerBackingDemands, type TsonicPointerBackingDemands,
  createTsonicPointerReturnQueries } from "@tsonic/source-core/facts";
import type {
  AstReader,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type {
  TargetCompileInput,
  TargetSelection,
} from "@tsonic/target-api";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustSourcePolicyContext } from "../../policy/model/context.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import type { RustProviderSemantics } from "../../providers/packages/model.js";
import {
  createRustNamePlan,
} from "../names/plan.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustSourceTypeFamilyRegistry } from "../../policy/types/type-families.js";
import { createRustSourceTypeFamilyRegistry } from "../project-types/type-families.js";
import { createRustTypeDefinitionRegistry, type RustTypeDefinitionRegistry } from "../project-types/type-definitions.js";
import { createRustClassValueRegistry, type RustClassValueRegistry } from "../objects/class-values.js";
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
import { createRustFrozenDataWriteRegistry, type RustFrozenDataWriteRegistry } from "../objects/frozen-data-writes.js";
import {
  createRustSafetyApplicationFactIndex,
} from "../safety/application-index.js";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import {
  createRustObjectRepresentationPlanRegistry,
  type RustObjectRepresentationPlanRegistry,
} from "../project-types/object-representation.js";
import {
  createRustRuntimeValueUsePlan,
  type RustRuntimeValueUsePlan,
} from "./runtime-value-uses.js";
import {
  analyzeRustLifetimes,
} from "../declarations/lifetimes.js";
import {
  emptyRustLifetimeIndex,
  type RustLifetimeIndex,
} from "../../target-model/lifetimes/index.js";
import {
  createRustGeneratedDeclarationUseRegistry,
  type RustGeneratedDeclarationUseRegistry,
} from "./generated-declaration-uses.js";

export interface RustAnalysisContext extends RustSourcePolicyContext {
  readonly typeDefinitions: RustTypeDefinitionRegistry;
  readonly typeFamilies: RustSourceTypeFamilyRegistry;
  readonly pointerBacking: TsonicPointerBackingDemands;
  readonly memoryMetadata: TsonicMemoryMetadataIndex;
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
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly structuralShapes: RustStructuralShapePlanRegistry;
  readonly frozenDataWrites: RustFrozenDataWriteRegistry;
  readonly classValues: RustClassValueRegistry;
  readonly providerSemantics: RustProviderSemantics;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly runtimeValueUses: RustRuntimeValueUsePlan;
  readonly generatedDeclarationUses: RustGeneratedDeclarationUseRegistry;
  readonly names: RustNamePlan;
  readonly diagnostics: TargetDiagnostic[];
  semantics(sourceFile: SourceFile): SourceFileSemantics;
  semanticsFor(node: Node): SourceFileSemantics;
}

export function createRustAnalysisContext(
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
  const typeDefinitions = createRustTypeDefinitionRegistry();
  const facts = createRustPlanBuilder(input.source.sourceFacts, typeDefinitions);
  const names = createRustNamePlan({
    ast,
    navigation: input.source.navigation,
    runtimeValueUses,
    sourceFiles,
  });
  const lifetimes = analyzeRustLifetimes({
    source: input.source,
    ast,
    sourceFiles,
    facts,
    names,
    referencedDeclaration(node) {
      return input.source.navigation.sourceReferenceFor(node)?.declaration;
    },
    semanticsFor: input.source.semantics.forNode,
  });
  const memoryBindings = createTsonicMemoryBindingIndex(input.source);
  return Object.freeze({
    typeDefinitions,
    typeFamilies: createRustSourceTypeFamilyRegistry(),
    pointerBacking: createTsonicPointerBackingDemands(input.source),
    pointerReturns: createTsonicPointerReturnQueries(input.source),
    memoryMetadata: createTsonicMemoryMetadataIndex(input.source),
    memoryBindings,
    source: input.source,
    target: input.target,
    jsEnabled,
    ast,
    sourceFiles,
    sourcePackages: input.sourcePackages,
    rootPublishesLibrary,
    facts,
    projectTypes: createRustProjectTypePolicyRegistry(),
    objectRepresentations: createRustObjectRepresentationPlanRegistry(),
    projectMethodDispatch: createRustProjectMethodDispatchPlanRegistry(),
    projectMethodProperties: createRustProjectMethodPropertyPlanRegistry(),
    projectFieldDispatch: createRustProjectFieldDispatchPlanRegistry(),
    sourceCallableSpecializations: createRustSourceCallableSpecializationPlanRegistry(),
    sourceLifetimes: lifetimes.index ?? emptyRustLifetimeIndex,
    structuralShapes: createRustStructuralShapePlanRegistry(),
    frozenDataWrites: createRustFrozenDataWriteRegistry(),
    classValues: createRustClassValueRegistry(),
    providerSemantics,
    safetyApplications,
    runtimeValueUses,
    generatedDeclarationUses: createRustGeneratedDeclarationUseRegistry(),
    names,
    diagnostics: [...lifetimes.diagnostics, ...memoryBindings.issues.map(issue => ({
      code: "RUST_MEMORY_BINDING_NOT_PROVEN", category: "error" as const, source: "tsonic-rust",
      sourceNode: issue.node, message: issue.reason,
    }))],
    semantics: input.source.semantics.forFile,
    semanticsFor: input.source.semantics.forNode,
  });
}

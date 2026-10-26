import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourcePackageGraph } from "@tsonic/target-api";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustOperationAttempt } from "../program/operation-attempts.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustGenericCallableConversion } from "../../target-model/conversions/generic-callable.js";
import type { RustCallableValueAdapter } from "../../target-model/records/callable-adapters.js";

import { createRustGenericCallablePlan, rustFixedStructuralMethodDeclarations, type RustGenericCallablePlan } from "./generic-values.js";
import { createRustSuspendedCallablePlan } from "./suspended-values.js";
import { type RustSuspendedCallablePlan } from "../../target-model/records/suspended-callables.js";

import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";
import { rustCallableAdapterValues } from "../../policy/conversions/callable-values.js";

import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { createRustFrameCallablePlan } from "./frame-values.js";
import type { RustFrameCallablePlan } from "../../target-model/records/frame-callables.js";
import type { RustCallableOwnershipPlan } from "./ownership-plan.js";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { createRustNativeCallableInputPlan, type RustNativeCallableInputPlan } from "./native-inputs.js";
import { createRustNativeStorageQueries, type RustNativeStorageConstruction, type RustNativeStoragePlan } from "./native-storage.js";
import { finalizeRustNativeParameterStorage } from "./native-parameters.js";
import { createRustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { createRustNativeGenericProducerPlan, prepareRustNativeGenericProducerRequests } from "./native-generic-producers.js";
import type { RustNativeGenericProducerPlan } from "../../target-model/records/native-generic-producers.js";
import { createRustNativeCapturePlan } from "./native-captures.js";
import type { RustNativeCapturePlan } from "../../target-model/records/native-captures.js";
import { createRustGenericCallableDispatchPlan, prepareRustGenericCallableDispatchRequests, type RustGenericCallableDispatchPlan } from "./generic-dispatch.js";
import { createRustGenericCallableIdentityPlan, prepareRustGenericCallableIdentityRequests, prepareRustGenericCallableIdentitySources } from "./generic-identities.js";
import type { RustGenericCallableIdentityPlan } from "../../target-model/records/generic-callable-identity.js";
import type { RustGenericCallablePhysicalCarrierSelector } from "./generic-physical.js";
import type { RustLexicalFunctionEnvironments } from "../../target-model/records/lexical-functions.js";
import { createRustNativeCallableDispatchPlan } from "./native-dispatch.js";
import type { RustNativeCallableDispatchPlan } from "../../target-model/records/native-dispatch.js";
import type { RustStructuralShapePlanRegistry } from "../objects/shapes/structural-shape-plan.js";
import { createRustGenericCallableCompletionPlan, type RustGenericCallableCompletionInput, type RustGenericCallableCompletionPlan } from "./generic-completions.js";
import { createRustPhysicalCallableLifecycle, type RustPhysicalCallableLifecycle, type RustPhysicalCallableEmissionRequest } from "./physical-lifecycle.js";
import { type RustPhysicalCallableStorage } from "../../target-model/records/native-storage.js";
import { prepareRustProjectCallableFieldStorage, type RustProjectCallableFieldStorage, type RustProjectCallableFieldStorageConstruction } from "./project-field-storage.js";
import type { RustGenericCallableFlowProducer } from "../program/records/generic-callable-flow.js";
import type { RustErrorRegionRecords } from "../../target-model/records/error-regions.js";
import { createRustStructuralMethodStorage } from "./structural-method-storage.js";
import type { RustValueDomainCarrierHost } from "../objects/value-domain-carriers.js";
import type { RustRetainedEnvironmentQueries } from "../../target-model/records/retained-environments.js";
import type { RustSourcePackageComponentClassifications } from "../../target-model/records/source-package-semantics.js";
import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import { normalizeRustErrorType, type RustErrorTypeContext } from "../errors/error-types.js";
import { asSourceNode } from "@tsonic/target-api/source";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import type { RustSourceTypeRegistry } from "../project-types/source-type-model.js";
import type { RustClassValuePlan } from "../../target-model/records/class-values.js";
import type { RustCallableEmissionContexts, RustPhysicalEmissionSourceOccurrence } from "../../target-model/records/physical-emission-contexts.js";
import type { RustInitializationErrorRecords } from "../../target-model/records/error-regions.js";
import type { RustProjectConstructionPlan } from "../project-types/construction-plan.js";
import type { RustGenericCallableErrorIndex } from "../../target-model/records/generic-callable-errors.js";
import { prepareRustProviderSourceOccurrences } from "../operations/provider-source-inputs.js";
import { prepareRustPhysicalEmissionContexts } from "../program/physical-emission-contexts.js";
import { prepareRustPhysicalCallableEmissionRequests } from "./emission-requests.js";
import type { SourceNativeTaskGraph } from "@tsonic/target-api/analysis";

import { analyzeRustNativeCallableGenerics } from "./native-inputs.js";
import type { RustNativeGenericProducer } from "../program/records/native-generics.js";
import type { RustRetainedCallableInputPlan } from "../../target-model/records/retained-inputs.js";
import type { RustPromiseBodies } from "../../target-model/records/callables-and-resources.js";
import { selectRustFrameEntryErrors } from "../errors/regions.js";

export interface RustCallableValuePlan {
  readonly emissionContexts: RustCallableEmissionContexts;
  readonly generic: RustGenericCallablePlan;
  readonly suspended: RustSuspendedCallablePlan;
  readonly frames: RustFrameCallablePlan;
  readonly native: Omit<RustNativeCallableInputPlan, "bindingsFor" | "originsFor" | "originsForValue" | "isConcreteCallableStorage">;
  readonly nativeStorage: RustPhysicalCallableStorage;
  readonly nativeCaptures: RustNativeCapturePlan;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly nativeGenericProducers: RustNativeGenericProducerPlan;
  readonly genericDispatch: RustGenericCallableDispatchPlan;
  readonly genericIdentities: RustGenericCallableIdentityPlan;
  readonly nativeDispatch: RustNativeCallableDispatchPlan;
  readonly genericCompletions: RustGenericCallableCompletionPlan;
  readonly projectFieldStorage: RustProjectCallableFieldStorage;
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
}

export type RustCallableValueSelection = Omit<RustCallableValuePlan, "native" | "nativeStorage" | "emissionContexts"> & {
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStorageConstruction;
};

export interface RustCallableValueSealInput {
  readonly nativeGenerics: RustNativeGenericProducer;
  readonly retainedCallableInputs: RustRetainedCallableInputPlan;
  readonly declarationGenericRequirements: RustDeclarationGenericRequirementIndex;
  readonly genericErrors: RustGenericCallableErrorIndex;
  readonly errorRegions: Pick<RustErrorRegionRecords, "get" | "sourceFor">;
  readonly initialization: RustInitializationErrorRecords;
  readonly constructions: readonly RustProjectConstructionPlan[];
}

export interface RustCallableValuePlanInput {
  readonly flowApplications: RustGenericCallableFlowProducer;
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourcePackages: TargetSourcePackageGraph;
  readonly records: RustProgramRecords;
  readonly operationAttempts: Pick<WeakMap<Node, RustOperationAttempt>, "get">;
  readonly names: RustNamePlan;
  readonly navigation: SourceProgramNavigation;
  readonly lifetimes: RustLifetimeIndex;
  readonly classValueAdapters: readonly { readonly subject: Node; readonly adapter: RustCallableValueAdapter }[];
  readonly closedSourceFiles: ReadonlySet<SourceFile>;
  readonly ownership: RustCallableOwnershipPlan;
  readonly frameBindingCarriers: ReadonlyMap<Node, TargetTypeRef>;
  readonly sourceStorage: SourceStorageQueries;
  readonly sourceTypes: Pick<RustSourceTypeRegistry, "structuralObjectForType">;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: import("../project-types/object-representation.js").RustObjectRepresentationPlan;
  readonly frozenDataWrites: Pick<import("../../target-model/records/frozen-data.js").RustFrozenDataWritePlan, "capturesFieldIdentity">;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly lexicalFunctions: RustLexicalFunctionEnvironments;
  readonly structuralShapes: RustStructuralShapePlanRegistry;
  readonly carrierHost: RustValueDomainCarrierHost;
  readonly retainedEnvironments: RustRetainedEnvironmentQueries;
  readonly nativeTasks: SourceNativeTaskGraph;
  readonly normalizeTypeFamily: (carrier: TargetTypeRef) => TargetTypeRef;
}

export interface RustCallableValueConstruction {
  readonly generic: RustGenericCallablePlan;
  readonly frames: RustFrameCallablePlan;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStorageConstruction;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
}

export interface RustCallableValuePlanRegistry extends RustCallableValueConstruction {
  initialize(input: RustCallableValuePlanInput): RustCallableValueConstruction;
  preparePhysicalStorage(components: RustSourcePackageComponentClassifications,
    effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined,
    promiseBodies: RustPromiseBodies): readonly RustSourceCallableSpecializationIssue[];
  finalizeSelected(): TargetStageResult<readonly RustSourceCallableSpecializationIssue[]>;
  readonly selected: RustCallableValueSelection;
  initializeCompletions(input: RustGenericCallableCompletionInput): void;
  finalizeStructuralStorage(errors: Pick<RustErrorRegionRecords, "producerError">): void;
  validateStructuralRetention(requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
    families: Pick<RustSourceTypeFamilyRegistry, "implementation">, classValues: RustClassValuePlan,
    errorTypes: RustErrorTypeContext): readonly RustSourceCallableSpecializationIssue[];
  seal(input: RustCallableValueSealInput): TargetStageResult<RustCallableValuePlan>;
  publish(): void;
}

interface RustCallableValueLifecycle {
  readonly construction: RustCallableValueConstruction;
  preparePhysicalStorage(components: RustSourcePackageComponentClassifications,
    effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined,
    promiseBodies: RustPromiseBodies): readonly RustSourceCallableSpecializationIssue[];
  finalizeSelected(): TargetStageResult<{ readonly plan: RustCallableValueSelection; readonly issues: readonly RustSourceCallableSpecializationIssue[] }>;
  finalizeStructuralStorage(errors: Pick<RustErrorRegionRecords, "producerError">): void;
  validateStructuralRetention(requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
    families: Pick<RustSourceTypeFamilyRegistry, "implementation">, classValues: RustClassValuePlan,
    errorTypes: RustErrorTypeContext): readonly RustSourceCallableSpecializationIssue[];
  seal(input: RustCallableValueSealInput): TargetStageResult<RustCallableValuePlan>;
  publish(): void;
}

export function createRustCallableValuePlanRegistry(): RustCallableValuePlanRegistry {
  let lifecycle: RustCallableValueLifecycle | undefined;
  let selected: RustCallableValueSelection | undefined;
  let finalizedSelection = false;
  let completions: RustGenericCallableCompletionPlan | undefined;
  const requireCompletions = (): RustGenericCallableCompletionPlan => {
    if (completions === undefined) failTargetAnalysisInvariant("tsonic-rust", "Generic callable completions require sealed producer effects and component owners.");
    return completions;
  };
  const requireLifecycle = (): RustCallableValueLifecycle => {
    if (lifecycle === undefined) failTargetAnalysisInvariant("tsonic-rust", "Rust callable values must be finalized after their selected adapters and before effect analysis.");
    return lifecycle;
  };
  const requireSelected = (): RustCallableValueSelection => {
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "Rust callable value inventories require their selected physical families after effect analysis.");
    return selected;
  };
  return Object.freeze({
    initialize(input: RustCallableValuePlanInput): RustCallableValueConstruction {
      if (lifecycle !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Rust callable value representations can be initialized only once.");
      lifecycle = createRustCallableValueLifecycle(input, requireCompletions);
      return lifecycle.construction;
    },
    finalizeSelected(): TargetStageResult<readonly RustSourceCallableSpecializationIssue[]> {
      const current = requireLifecycle();
      if (finalizedSelection) failTargetAnalysisInvariant("tsonic-rust", "Rust callable value inventories finalize exactly once.");
      const finalized = current.finalizeSelected();
      finalizedSelection = true;
      if (finalized.kind === "rejected") return finalized;
      selected = finalized.value.plan;
      return resolvedTargetStage(finalized.value.issues);
    },
    get selected() { return requireSelected(); },
    preparePhysicalStorage(components: RustSourcePackageComponentClassifications,
      effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined, promiseBodies: RustPromiseBodies) {
      return requireLifecycle().preparePhysicalStorage(components, effectsFor, promiseBodies);
    },
    initializeCompletions(input: RustGenericCallableCompletionInput): void {
      const current = requireSelected();
      if (completions !== undefined || input.physical !== current.generic.physical || input.producers !== current.nativeProducers)
        failTargetAnalysisInvariant("tsonic-rust", "Generic callable completions finalize exactly once from their owned physical family and producer plans.");
      completions = createRustGenericCallableCompletionPlan(input);
    },
    seal: (input: RustCallableValueSealInput) => requireLifecycle().seal(input),
    finalizeStructuralStorage: (errors: Pick<RustErrorRegionRecords, "producerError">) => requireLifecycle().finalizeStructuralStorage(errors),
    validateStructuralRetention: (requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
      families: Pick<RustSourceTypeFamilyRegistry, "implementation">, classValues: RustClassValuePlan,
      errorTypes: RustErrorTypeContext) =>
      requireLifecycle().validateStructuralRetention(requirements, families, classValues, errorTypes),
    publish(): void {
      requireSelected();
      requireLifecycle().publish();
    },
    get generic() { return requireLifecycle().construction.generic; },
    get frames() { return requireLifecycle().construction.frames; },
    get native() { return requireLifecycle().construction.native; },
    get nativeStorage() { return requireLifecycle().construction.nativeStorage; },
    get nativeProducers() { return requireLifecycle().construction.nativeProducers; },
    get issues() { return requireLifecycle().construction.issues; },
  });
}

function createRustCallableValueLifecycle(input: RustCallableValuePlanInput,
  completions: () => RustGenericCallableCompletionPlan): RustCallableValueLifecycle {
  const flows: { subject: Node; conversion: RustGenericCallableConversion }[] = [];
  const usedNames = new Set<string>();
  const recordField = (subject: Node, source: TargetTypeRef | undefined, target: TargetTypeRef | undefined): void => {
    if (source === undefined || target === undefined) return;
    const sourceCarrier = rustOptionElementCarrier(source) ?? source;
    const targetCarrier = rustOptionElementCarrier(target) ?? target;
    if (rustGenericCallableValue(sourceCarrier) !== undefined && rustGenericCallableValue(targetCarrier) !== undefined) flows.push({ subject,
      conversion: { kind: "generic-callable-flow", source: sourceCarrier, target: targetCarrier },
    });
  };
  const record = (subject: Node, adapter: RustCallableValueAdapter): void => {
    switch (adapter.kind) {
      case "conversion":
        if (adapter.conversion.kind === "generic-callable-flow") flows.push({ subject, conversion: adapter.conversion });
        break;
      case "option-map":
      case "option-some": record(subject, adapter.element); break;
      case "identity":
      case "project-structural-view":
      case "project-upcast":
      case "call-scoped-lifetime": break;
    }
  };
  for (const { subject, adapter } of input.classValueAdapters) record(subject, adapter);
  const visit = (node: Node): void => {
    if (!input.isNativeNode(node)) return;
    for (const name of [input.names.nameForDeclaration(node), input.names.functionNameForDeclaration(node),
      input.names.callableValueNameForDeclaration(node)]) {
      if (name !== undefined) usedNames.add(name);
    }
    const operation = input.records.targetOperation.get(node);
    if (operation?.kind === "record-literal") {
      const targets = new Map(operation.fields.map(field => [field.storageIndex, field.carrier]));
      for (const contribution of operation.contributions) {
        if (contribution.kind !== "spread") continue;
        const source = rustStructuralObjectCarrierValue(contribution.sourceCarrier);
        for (const field of contribution.fields) recordField(node, source?.fields[field.sourceStorageIndex]?.type,
          targets.get(field.targetStorageIndex));
      }
    }
    const view = input.records.objectReferenceView.get(node);
    if (view?.kind === "structural") {
      const target = rustStructuralObjectCarrierValue(view.targetCarrier);
      for (const field of view.fields) recordField(node, field.source.resultCarrier,
        target?.fields[field.destinationIndex]?.type);
    }
    const binding = input.records.bindingProjection.get(node);
    if (binding !== undefined && "bindingCarrier" in binding && binding.projection.kind === "object-rest") {
      const source = rustStructuralObjectCarrierValue(binding.sourceCarrier);
      const target = rustStructuralObjectCarrierValue(binding.bindingCarrier);
      for (const field of binding.projection.fields) recordField(node,
        source?.fields[field.sourceStorageIndex]?.type, target?.fields[field.targetStorageIndex]?.type);
    }
    for (const dispatch of input.records.objectLiteralMethodAdapter.get(node)?.dispatches ?? []) {
      for (const adapter of rustCallableAdapterValues(dispatch)) record(node, adapter);
    }
    for (const dispatch of input.records.projectCallableAdapters.get(node) ?? []) {
      for (const adapter of rustCallableAdapterValues(dispatch)) record(node, adapter);
    }
    input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of input.sourceFiles) visit(sourceFile);
  const genericRegistry = createRustGenericCallablePlan(input.ast, input.sourceFiles, input.records, input.names, input.navigation, input.isNativeNode,
    rustFixedStructuralMethodDeclarations(input.ast, input.structuralShapes), flows, input.closedSourceFiles);
  const generic = genericRegistry.plan;
  for (const definition of generic.definitions) {
    usedNames.add(definition.targetName);
    for (const implementation of definition.implementations) {
      usedNames.add(implementation.functionName);
      usedNames.add(implementation.stateName);
    }
  }
  const genericImplementations = new Set(generic.definitions.flatMap(definition =>
    definition.implementations.map(implementation => implementation.declaration)));
  const frameConstruction = createRustFrameCallablePlan({ ...input, usedNames });
  const retentionIssues: RustSourceCallableSpecializationIssue[] = [];
  const native = createRustNativeCallableInputPlan({ ast: input.ast, records: input.records, sourcePackages: input.sourcePackages,
    storage: input.sourceStorage, nativeNodes: input.nativeNodes, definitions: input.typeDefinitions, projectTypes: input.projectTypes, usedNames,
    declaresGenericInputs: owner => input.ast.is.IsFunctionDeclaration(owner) || input.ast.is.IsMethodDeclaration(owner) ||
      input.ast.is.IsConstructorDeclaration(owner) || input.ast.is.IsGetAccessorDeclaration(owner) ||
      input.ast.is.IsSetAccessorDeclaration(owner) || genericImplementations.has(owner) ||
      input.lexicalFunctions.forDeclaration(owner)?.kind === "resolved",
    ownedRetainedParameter: parameter => {
      const declaration = input.ast.parent(parameter);
      if (declaration === undefined || input.ast.hasModifierKind(declaration, "async")) return false;
      const selected = input.retainedEnvironments.inputsFor(declaration);
      if (selected.kind === "unresolved") {
        retentionIssues.push({ subject: declaration, message: selected.reason });
        return false;
      }
      return selected.ownership === "owned" &&
        input.retainedEnvironments.suspendedParametersFor(declaration)?.includes(parameter) === true;
    } });
  const nativeProducers = createRustNativeCallableProducerPlan({ source: input.sourceStorage.source, ast: input.ast, records: input.records,
    nodes: input.nativeNodes, native, definitions: input.typeDefinitions,
    returnCarrierFor: declaration => {
      const selected = nativeStorageQueries.prepareReturn(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  let physicalCarrierFor: RustGenericCallablePhysicalCarrierSelector | undefined;
  let producerErrors: Pick<RustErrorRegionRecords, "producerError"> | undefined;
  const nativeStorageQueries = createRustNativeStorageQueries({ ast: input.ast, records: input.records,
    operationAttempts: input.operationAttempts,
    frames: frameConstruction,
    storage: input.sourceStorage, nativeNodes: input.nativeNodes, definitions: input.typeDefinitions, native, producers: nativeProducers, generic,
    capturesFor: declaration => captures.forDeclaration(declaration),
    carrierHost: input.carrierHost,
    physicalCarrierFor: (carrier, ownerFileName, subject, bindings, producers) => {
      if (physicalCarrierFor === undefined) failTargetAnalysisInvariant("tsonic-rust", "Generic callable physical storage requires its finalized declaration inputs.");
      return physicalCarrierFor(carrier, ownerFileName, subject, bindings, producers);
    },
    lexicalFunctions: input.lexicalFunctions, lifetimes: input.lifetimes, structuralShapes: input.structuralShapes,
    producerErrorFor: reference => producerErrors?.producerError(reference), normalizeTypeFamily: input.normalizeTypeFamily });
  const captures = createRustNativeCapturePlan({ records: input.records, storage: input.sourceStorage,
    nativeStorage: nativeStorageQueries });
  const physical = genericRegistry.initializePhysical({ ast: input.ast, lifetimes: input.lifetimes,
    storage: input.sourceStorage, captures, native,
    genericBindingsFor: nativeStorageQueries.genericBindingsFor,
    boundSubjectFor: (subject, carrier, bindings) => nativeStorageQueries.boundSubjectFor(subject, carrier, bindings) });
  physicalCarrierFor = physical.carrierFor;
  let parameterStorage: RustNativeStoragePlan | undefined;
  let projectFieldStorage: RustProjectCallableFieldStorageConstruction | undefined;
  const nativeStorage: RustNativeStorageConstruction = Object.freeze({ ...nativeStorageQueries,
    parameterFor(parameter: Node) {
      if (parameterStorage === undefined) failTargetAnalysisInvariant("tsonic-rust", "Native parameter storage requires completed intrinsic effects and constructor ABI selection.");
      return parameterStorage.parameterFor(parameter);
    },
  });
  const nativeDispatch = createRustNativeCallableDispatchPlan({ ...input, native });
  const issues = Object.freeze([...generic.issues, ...nativeStorage.issues, ...retentionIssues]);
  const construction: RustCallableValueConstruction = Object.freeze({ generic, frames: frameConstruction,
    native, nativeStorage, nativeProducers, issues });
  let physicalLifecycle: RustPhysicalCallableLifecycle | undefined;
  let emissionRequests: readonly RustPhysicalCallableEmissionRequest[] | undefined;
  let sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[] | undefined;
  let structuralMethodStorage: ReturnType<typeof createRustStructuralMethodStorage> | undefined;
  let selectedPlan: RustCallableValueSelection | undefined;
  let publishedPlan: RustCallableValuePlan | undefined;
  let sealResult: TargetStageResult<RustCallableValuePlan> | undefined;
  return Object.freeze({
    construction,
    preparePhysicalStorage(components: RustSourcePackageComponentClassifications,
      effectsFor: (declaration: Node) => RustErrorEffectsFact | undefined, promiseBodies: RustPromiseBodies) {
      if (structuralMethodStorage !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Physical callable storage prepares once after its intrinsic source effects.");
      structuralMethodStorage = createRustStructuralMethodStorage({ ...input, native, nativeStorage, nativeProducers,
        nativeCaptures: captures, genericCallables: generic, frames: frameConstruction });
      const context = { ast: input.ast, components, producers: nativeProducers, definitions: input.typeDefinitions,
        records: { ...input.records, errorEffects: { get(subject: import("@tsonic/tsts").ExtensionFactSubject | undefined) {
          const node = asSourceNode(subject, input.ast);
          return node === undefined ? undefined : effectsFor(node);
        } } } };
      producerErrors = Object.freeze({ producerError(reference: RustProducerErrorReference) {
        return normalizeRustErrorType({ kind: "target-specific", target: "rust", name: "producer-error", value: reference }, context);
      } });
      const frameIssues = frameConstruction.completeErrors((definition, entry) =>
        selectRustFrameEntryErrors(definition, entry, { ...context, promiseBodies }, effectsFor));
      if (frameIssues.length !== 0) return frameIssues;
      const constructorIssues = structuralMethodStorage.prepareConstructors(components, effectsFor, nativeProducers);
      if (constructorIssues.length !== 0) return constructorIssues;
      const storageIssues = structuralMethodStorage.complete(producerErrors);
      if (storageIssues.length !== 0) return storageIssues;
      parameterStorage = finalizeRustNativeParameterStorage({ ast: input.ast, storage: input.sourceStorage,
        nativeNodes: input.nativeNodes, records: input.records }, nativeStorageQueries);
      projectFieldStorage = prepareRustProjectCallableFieldStorage({ ast: input.ast, records: input.records,
        storage: input.sourceStorage, projectTypes: input.projectTypes },
      (subject, carrier) => nativeStorageQueries.subjectFor(subject, carrier));
      return Object.freeze([]);
    },
    finalizeSelected() {
      if (structuralMethodStorage === undefined || projectFieldStorage === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "Physical callable families require their completed constructor and field storage selection.");
      const suspended = createRustSuspendedCallablePlan(input.ast, input.nativeNodes, input.records, input.names, input.lifetimes,
        Object.freeze({ forDeclaration: captures.require }));
      for (const implementation of suspended.implementations) usedNames.add(implementation.stateName);
      const frames = frameConstruction;
      const occurrences = prepareRustProviderSourceOccurrences({ ast: input.ast, nodes: input.nativeNodes,
        isNativeNode: input.isNativeNode, records: input.records, semantics: input.sourceStorage.source.semantics });
      if (occurrences.kind === "rejected") {
        sealResult = rejectedTargetStage(occurrences.diagnostics);
        return occurrences;
      }
      sourceOccurrences = occurrences.value;
      const identitySources = prepareRustGenericCallableIdentitySources({ ast: input.ast, nodes: input.nativeNodes, records: input.records });
      const requests = prepareRustPhysicalCallableEmissionRequests({ ...input, sourceLifetimes: input.lifetimes,
        generic, frames, suspended, native, nativeProducers, adapterFlows: flows, sourceOccurrences, identitySources });
      if (requests.kind === "rejected") {
        sealResult = rejectedTargetStage(requests.diagnostics);
        return requests;
      }
      emissionRequests = requests.value;
      physicalLifecycle = createRustPhysicalCallableLifecycle({ ast: input.ast, records: input.records, flowApplications: input.flowApplications,
        sourceStorage: input.sourceStorage, requests: emissionRequests, sourceOccurrences, typeDefinitions: input.typeDefinitions,
        lexicalFunctions: input.lexicalFunctions, structuralShapes: input.structuralShapes,
        nativeStorage, nativeProducers, adapterFlows: flows });
      const producerRequests = prepareRustNativeGenericProducerRequests({ ast: input.ast, nodes: input.nativeNodes,
        records: input.records, generic, native, nativeStorage, definitions: input.typeDefinitions });
      const identityRequests = prepareRustGenericCallableIdentityRequests({ sources: identitySources, nativeStorage: physicalLifecycle.prepared });
      const dispatchRequests = prepareRustGenericCallableDispatchRequests({ ...input, nodes: input.nativeNodes, generic,
        nativeStorage: physicalLifecycle.prepared });
      physical.closeAdmission();
      const nativeCaptures = captures.complete();
      const nativeGenericProducers = createRustNativeGenericProducerPlan({ records: input.records, generic, nativeStorage,
        requests: producerRequests });
      const genericIdentities = createRustGenericCallableIdentityPlan({ physical: generic.physical, requests: identityRequests });
      const genericDispatch = createRustGenericCallableDispatchPlan({ ast: input.ast, generic, closedSourceFiles: input.closedSourceFiles,
        nativeGenericProducers, invocations: dispatchRequests });
      const selectedIssues = Object.freeze([...suspended.issues, ...frames.issues, ...genericIdentities.issues]);
      const plan: RustCallableValueSelection = Object.freeze({ generic, suspended, frames, native, nativeStorage, nativeCaptures, nativeProducers,
        nativeGenericProducers, genericDispatch, genericIdentities, nativeDispatch, get genericCompletions() { return completions(); },
        projectFieldStorage,
        issues: Object.freeze([...issues, ...selectedIssues]) });
      selectedPlan = plan;
      return resolvedTargetStage(Object.freeze({ plan, issues: selectedIssues }));
    },
    finalizeStructuralStorage(errors: Pick<RustErrorRegionRecords, "producerError">) {
      if (structuralMethodStorage === undefined) failTargetAnalysisInvariant("tsonic-rust", "Structural physical storage requires selected callable families.");
      structuralMethodStorage.validateErrors(errors);
    },
    validateStructuralRetention(requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">,
      families: Pick<RustSourceTypeFamilyRegistry, "implementation">, classValues: RustClassValuePlan,
      errorTypes: RustErrorTypeContext) {
      if (structuralMethodStorage === undefined || selectedPlan === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "Structural retention requires completed physical field selection.");
      return structuralMethodStorage.validateRetention(requirements, families, selectedPlan.frames, classValues, errorTypes);
    },
    seal(late: RustCallableValueSealInput): TargetStageResult<RustCallableValuePlan> {
      if (sealResult !== undefined) return sealResult;
      if (physicalLifecycle === undefined || selectedPlan === undefined || frameConstruction === undefined ||
        emissionRequests === undefined || sourceOccurrences === undefined || projectFieldStorage === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "Physical callable publication requires completed source-selected families and effects.");
      const publication = physicalLifecycle.complete(physical);
      if (publication.kind === "rejected") {
        sealResult = rejectedTargetStage(publication.diagnostics);
        return sealResult;
      }
      const fields = projectFieldStorage.seal();
      if (fields.kind === "rejected") {
        sealResult = fields;
        return fields;
      }
      const frames = frameConstruction.sealCounters(late.constructions);
      const nativeGenericContexts = analyzeRustNativeCallableGenerics({ source: input.sourceStorage.source,
        ast: input.ast, lifetimes: input.lifetimes, records: input.records, producer: late.nativeGenerics,
        native, nativeStorage: publication.value.nativeStorage, nativeProducers: publication.value.nativeProducers,
        nativeGenericProducers: selectedPlan.nativeGenericProducers, retainedCallableInputs: late.retainedCallableInputs,
        declarationGenericRequirements: late.declarationGenericRequirements });
      if (nativeGenericContexts.kind === "rejected") {
        sealResult = rejectedTargetStage(nativeGenericContexts.diagnostics);
        return sealResult;
      }
      const emission = prepareRustPhysicalEmissionContexts({ ...late, ast: input.ast, sourceFiles: input.sourceFiles,
        isNativeNode: input.isNativeNode, records: input.records, sourceLifetimes: input.lifetimes,
        sourceStorage: input.sourceStorage, genericBindingsFor: nativeStorage.genericBindingsFor,
        projectTypes: input.projectTypes,
        generic, frames, suspended: selectedPlan.suspended, native,
        nativeStorage: publication.value.nativeStorage, nativeProducers: publication.value.nativeProducers,
        genericCompletions: completions(), sourceOccurrences, emissionRequests });
      if (emission.kind === "rejected") {
        sealResult = rejectedTargetStage(emission.diagnostics);
        return sealResult;
      }
      for (const carrier of emission.value.physicalOperands) physical.prepare(carrier);
      const finalPhysical = physical.closeKeys();
      genericRegistry.publishPhysical(finalPhysical);
      const nativeInputs: RustCallableValuePlan["native"] = Object.freeze({ inputs: native.inputs,
        protocols: native.protocols, calls: native.calls, callFor: native.callFor, inputsFor: native.inputsFor,
        capturesFor: native.capturesFor, protocolForSourceItem: native.protocolForSourceItem,
        isConcreteCallableParameter: native.isConcreteCallableParameter,
        isNativeRetainedParameter: native.isNativeRetainedParameter });
      publishedPlan = Object.freeze({ ...selectedPlan, ...publication.value, native: nativeInputs, frames,
        projectFieldStorage: fields.value, emissionContexts: emission.value.contexts });
      sealResult = resolvedTargetStage(publishedPlan);
      return sealResult;
    },
    publish(): void {
      if (publishedPlan === undefined) failTargetAnalysisInvariant("tsonic-rust", "Callable values publish only after their physical applications seal.");
      physical.publish();
    },
  });
}

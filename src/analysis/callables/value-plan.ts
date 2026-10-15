import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourcePackageGraph } from "@tsonic/target-api";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustGenericCallableConversion } from "../../target-model/conversions/generic-callable.js";
import type { RustCallableValueAdapter } from "../../target-model/records/callable-adapters.js";

import { createRustGenericCallablePlan, type RustGenericCallablePlan } from "./generic-values.js";
import { createRustSuspendedCallablePlan, type RustSuspendedCallablePlan } from "./suspended-values.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";
import { rustCallableAdapterValues } from "./adapter-values.js";

import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";

import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { createRustFrameCallablePlan, type RustFrameCallablePlan } from "./frame-values.js";
import type { RustCallableOwnershipPlan } from "./ownership-plan.js";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { createRustNativeCallableInputPlan, type RustNativeCallableInputPlan } from "./native-inputs.js";
import { createRustNativeStorageQueries, type RustNativeStoragePlan } from "./native-storage.js";
import { finalizeRustNativeParameterStorage } from "./native-parameters.js";
import { createRustNativeCallableProducerPlan, type RustNativeCallableProducerPlan } from "./native-producers.js";
import { createRustNativeGenericProducerPlan, type RustNativeGenericProducerPlan } from "./native-generic-producers.js";
import { createRustNativeCapturePlan, type RustNativeCapturePlan } from "./native-captures.js";
import { createRustGenericCallableDispatchPlan, type RustGenericCallableDispatchPlan } from "./generic-dispatch.js";
import { createRustGenericCallableIdentityPlan, type RustGenericCallableIdentityPlan } from "./generic-identities.js";
import type { RustLexicalFunctionEnvironments } from "./lexical-functions.js";
import { createRustNativeCallableDispatchPlan, type RustNativeCallableDispatchPlan } from "./native-dispatch.js";
import type { RustStructuralStorageLookup } from "../operations/target-operation.js";
import { createRustGenericCallableCompletionPlan, type RustGenericCallableCompletionInput,
  type RustGenericCallableCompletionPlan } from "./generic-completions.js";

export interface RustCallableValuePlan {
  readonly generic: RustGenericCallablePlan;
  readonly suspended: RustSuspendedCallablePlan;
  readonly frames: RustFrameCallablePlan;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustNativeStoragePlan;
  readonly nativeCaptures: RustNativeCapturePlan;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly nativeGenericProducers: RustNativeGenericProducerPlan;
  readonly genericDispatch: RustGenericCallableDispatchPlan;
  readonly genericIdentities: RustGenericCallableIdentityPlan;
  readonly nativeDispatch: RustNativeCallableDispatchPlan;
  readonly genericCompletions: RustGenericCallableCompletionPlan;
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
}

export interface RustCallableValuePlanInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourcePackages: TargetSourcePackageGraph;
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
  readonly navigation: SourceProgramNavigation;
  readonly lifetimes: RustLifetimeIndex;
  readonly classValueAdapters: readonly { readonly subject: Node; readonly adapter: RustCallableValueAdapter }[];
  readonly closedSourceFiles: ReadonlySet<SourceFile>;
  readonly ownership: RustCallableOwnershipPlan;
  readonly sourceStorage: SourceStorageQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: import("../project-types/object-representation.js").RustObjectRepresentationPlan;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly lexicalFunctions: RustLexicalFunctionEnvironments;
  readonly structuralShapes: RustStructuralStorageLookup;
}

export interface RustCallableValuePlanRegistry extends RustCallableValuePlan {
  initialize(input: RustCallableValuePlanInput): RustCallableValuePlan;
  initializeCompletions(input: RustGenericCallableCompletionInput): void;
  seal(): RustCallableValuePlan;
}

export function createRustCallableValuePlanRegistry(): RustCallableValuePlanRegistry {
  let current: RustCallableValuePlan | undefined;
  let completions: RustGenericCallableCompletionPlan | undefined;
  const requireCompletions = (): RustGenericCallableCompletionPlan => {
    if (completions === undefined) throw new Error("Generic callable completions require sealed producer effects and component owners.");
    return completions;
  };
  const requireCurrent = (): RustCallableValuePlan => {
    if (current === undefined) throw new Error("Rust callable values must be finalized after their selected adapters and before effect analysis.");
    return current;
  };
  return Object.freeze({
    initialize(input: RustCallableValuePlanInput) {
      if (current !== undefined) throw new Error("Rust callable value representations can be initialized only once.");
      current = createRustCallableValuePlan(input, requireCompletions);
      return current;
    },
    initializeCompletions(input: RustGenericCallableCompletionInput): void {
      const current = requireCurrent();
      if (completions !== undefined || input.physical !== current.generic.physical || input.producers !== current.nativeProducers)
        throw new Error("Generic callable completions finalize exactly once from their owned physical family and producer plans.");
      completions = createRustGenericCallableCompletionPlan(input);
    },
    seal: requireCurrent,
    get generic() { return requireCurrent().generic; },
    get suspended() { return requireCurrent().suspended; },
    get frames() { return requireCurrent().frames; },
    get native() { return requireCurrent().native; },
    get nativeStorage() { return requireCurrent().nativeStorage; },
    get nativeCaptures() { return requireCurrent().nativeCaptures; },
    get nativeProducers() { return requireCurrent().nativeProducers; },
    get nativeGenericProducers() { return requireCurrent().nativeGenericProducers; },
    get genericDispatch() { return requireCurrent().genericDispatch; },
    get genericIdentities() { return requireCurrent().genericIdentities; },
    get nativeDispatch() { return requireCurrent().nativeDispatch; },
    get genericCompletions() { return requireCompletions(); },
    get issues() { return requireCurrent().issues; },
  });
}

function createRustCallableValuePlan(input: RustCallableValuePlanInput,
  completions: () => RustGenericCallableCompletionPlan): RustCallableValuePlan {
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
    if (binding?.projection.kind === "object-rest") {
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
  const generic = createRustGenericCallablePlan(input.ast, input.sourceFiles, input.records, input.names, input.navigation, flows, input.closedSourceFiles);
  for (const definition of generic.definitions) {
    usedNames.add(definition.targetName);
    for (const implementation of definition.implementations) {
      usedNames.add(implementation.functionName);
      usedNames.add(implementation.stateName);
    }
  }
  const native = createRustNativeCallableInputPlan({ ast: input.ast, records: input.records, sourcePackages: input.sourcePackages,
    storage: input.sourceStorage, definitions: input.typeDefinitions, usedNames });
  const nativeProducers = createRustNativeCallableProducerPlan({ ast: input.ast, records: input.records,
    nodes: input.sourceStorage.nodes, native, definitions: input.typeDefinitions,
    returnCarrierFor: declaration => {
      const selected = nativeStorageQueries.returnFor(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  const nativeStorageQueries = createRustNativeStorageQueries({ ast: input.ast, records: input.records,
    storage: input.sourceStorage, definitions: input.typeDefinitions, native, producers: nativeProducers, generic,
    lexicalFunctions: input.lexicalFunctions, lifetimes: input.lifetimes, structuralShapes: input.structuralShapes });
  const nativeCaptures = createRustNativeCapturePlan({ records: input.records, storage: input.sourceStorage,
    nativeStorage: nativeStorageQueries });
  generic.initializePhysical({ ast: input.ast, storage: input.sourceStorage, captures: nativeCaptures, native,
    boundSubjectFor: (subject, carrier, bindings) => nativeStorageQueries.boundSubjectFor(subject, carrier, bindings) });
  const nativeStorage = finalizeRustNativeParameterStorage({ ast: input.ast, storage: input.sourceStorage,
    records: input.records }, nativeStorageQueries);
  const genericCarriers = new Map<TargetTypeRef, boolean>();
  const containsGeneric = (carrier: TargetTypeRef | undefined): boolean => {
    if (carrier === undefined) return false;
    const known = genericCarriers.get(carrier);
    if (known !== undefined) return known;
    genericCarriers.set(carrier, false);
    const selected = rustGenericCallableValue(carrier) !== undefined || rustTargetTypeChildren(carrier).some(containsGeneric);
    genericCarriers.set(carrier, selected);
    return selected;
  };
  for (const node of input.sourceStorage.nodes) {
    if (containsGeneric(input.records.sourceCallableReturn.get(node)?.returnCarrier)) nativeStorage.returnFor(node);
    if (containsGeneric(input.records.runtimeCarrier.get(node)?.carrier)) nativeStorage.valueFor(node);
  }
  const suspended = createRustSuspendedCallablePlan(input.ast, input.sourceFiles, input.records, input.names, input.lifetimes, nativeCaptures);
  for (const implementation of suspended.implementations) usedNames.add(implementation.stateName);
  const frames = createRustFrameCallablePlan({ ...input, usedNames });
  const nativeGenericProducers = createRustNativeGenericProducerPlan({ ast: input.ast, nodes: input.sourceStorage.nodes,
    records: input.records, generic, native, nativeStorage, definitions: input.typeDefinitions });
  const genericIdentities = createRustGenericCallableIdentityPlan({ ast: input.ast, nodes: input.sourceStorage.nodes,
    records: input.records, nativeStorage, physical: generic.physical });
  const genericDispatch = createRustGenericCallableDispatchPlan({ ...input,
    nodes: input.sourceStorage.nodes, generic, nativeStorage, nativeGenericProducers });
  const nativeDispatch = createRustNativeCallableDispatchPlan({ ...input, native });
  return Object.freeze({ generic, suspended, frames, native, nativeStorage, nativeCaptures, nativeProducers, nativeGenericProducers,
    genericDispatch, genericIdentities, nativeDispatch, get genericCompletions() { return completions(); },
    issues: Object.freeze([...generic.issues, ...nativeStorage.issues, ...suspended.issues, ...frames.issues, ...genericIdentities.issues]) });
}

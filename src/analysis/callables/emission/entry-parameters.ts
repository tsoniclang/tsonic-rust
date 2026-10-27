import type { Node } from "@tsonic/tsts";
import { snapshotTargetReadonlyMap } from "@tsonic/target-api/analysis";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";
import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native/native-producers.js";
import type { RustNativeCallableGenericHeader } from "../../../target-model/records/native/native-generics.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustDeclarationEmissionProducer } from "../../program/records/program/declaration-emission.js";
import { requireRustRecord, type RustRequiredRecord } from "../../program/records/objects/required-records.js";
import type { RustNativeStorageConstruction } from "../storage/native-storage.js";
import { selectRustCallableEntryGenerics } from "./entry-generics.js";
import type { RustNativeCallableInputPlan } from "../native/native-inputs.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { closeRustRetainedCallableCarrier } from "../../../policy/ownership/retained-storage.js";
import { rustStaticLifetime } from "../../../target-model/lifetimes/index.js";
import type { RustGenericCallablePlan } from "../generics/generic-values.js";
import type { RustNativeGenericEntry } from "../../../target-model/records/program/declaration-emission.js";
import type { RustGenericCallableImplementation } from "../../../target-model/records/callables/generic-callables.js";
import { rustGenericCallableStorageArguments } from "../../../target-model/types/carriers/generic-callable-storage.js";
import { selectRustNativeHelperStatePassing, selectRustNativeFrameOwnerPassing } from "../../../policy/ownership/generic-callables.js";
import type { RustFrameCallablePlanRegistry } from "../values/frame-values.js";
import type { RustClassValuePlan } from "../../../target-model/records/objects/class-values.js";
import type { RustFrameCallableImplementation } from "../../../target-model/records/callables/frame-callables.js";
import type { RustNativeFrameEntry } from "../../../target-model/records/program/declaration-emission.js";
import type { RustCallableLeadingEmission } from "../../../target-model/records/program/declaration-emission.js";
import { createRustNativeEntryLayouts } from "./entry-layout.js";
import type { RustProjectTypePolicy } from "../../project-types/index.js";
import type { RustStructuralShapePlan } from "../../objects/shapes/structural-shape-plan.js";
import { createRustCallableEntryHeaderSelections, type RustCallableEntryHeaderInput } from "./entry-header-selections.js";
import type { RustDeclarationGenericRequirementIndex } from "../../declarations/generic-requirements.js";
import type { RustCallableEntryHeaderFacets, RustCallableEntryHeaderPlacement, RustCallableEntryHeaderVariant, RustCallableEntryHeaderSelection } from "../../../target-model/records/callables/callable-entry-headers.js";

export interface RustCallableEntryConstruction {
  get(declaration: Node): RustCallableLeadingEmission | undefined;
  selectHeader(declaration: Node, placement: RustCallableEntryHeaderPlacement, variant: RustCallableEntryHeaderVariant | undefined,
    parent: RustCallableEntryHeaderSelection | undefined, request: RustCallableEntryHeaderInput): RustCallableEntryHeaderFacets;
  seal(): void;
}

export function prepareRustCallableEntryParameters(input: {
  readonly source: TargetSourceProgram;
  readonly nodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly lifetimes: RustLifetimeIndex;
  readonly nativeStorage: RustNativeStorageConstruction;
  readonly native: Pick<RustNativeCallableInputPlan, "inputsFor" | "capturesFor" | "isNativeRetainedParameter">;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly generic: RustGenericCallablePlan;
  readonly frames: Pick<RustFrameCallablePlanRegistry, "nativeTypeFor" | "definitions">;
  readonly classValues: RustClassValuePlan;
  readonly projectTypes: RustProjectTypePolicy;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly producer: RustDeclarationEmissionProducer;
  readonly required: RustRequiredRecord[];
  readonly requirements: Pick<RustDeclarationGenericRequirementIndex, "contractFor">;
}): TargetStageResult<RustCallableEntryConstruction> {
  const { ast } = input.source;
  const issues: TargetDiagnostic[] = [];
  const headers = new Map<Node, RustNativeCallableGenericHeader>();
  const genericEntries = new Map<Node, Map<RustGenericCallableImplementation, RustNativeGenericEntry>>();
  for (const definition of input.generic.definitions) for (const implementation of definition.implementations) {
    const entries = genericEntries.get(implementation.declaration) ?? new Map<RustGenericCallableImplementation, RustNativeGenericEntry>();
    if (entries.has(implementation)) continue;
    const environment = input.generic.physical.environmentFor(implementation);
    if (environment === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted generic native entry requires its completed physical capture environment.", implementation.declaration);
    const suspended = input.records.asyncFunction.get(implementation.declaration) !== undefined ||
      input.records.generator.get(implementation.declaration) !== undefined;
    const helper = implementation.creation === "activation";
    const captures = environment.captures.length + environment.receiverFields.length + environment.receivers.length;
    const statePassing = selectRustNativeHelperStatePassing({ suspended, storage: implementation.storage,
      hasPayload: helper && captures !== 0 });
    entries.set(implementation, Object.freeze({ implementation, environment, suspended, helper, statePassing,
      arguments: rustGenericCallableStorageArguments(definition.signature.environmentParameters, environment.parameters) }));
    genericEntries.set(implementation.declaration, entries);
  }
  const declarations = new Set(input.nodes.filter(node => ast.is.IsFunctionDeclaration(node) ||
    ast.is.IsFunctionExpression(node) || ast.is.IsArrowFunction(node) || ast.is.IsMethodDeclaration(node) ||
    ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node)));
  const sourceParameters = new Map<Node, Map<Node, TargetTypeRef>>();
  for (const declaration of genericEntries.keys()) declarations.add(declaration);
  const frameEntries = new Map<Node, Map<RustFrameCallableImplementation, RustNativeFrameEntry>>();
  for (const definition of input.frames.definitions) for (const entry of definition.entries) for (const implementation of entry.implementations) {
    if (implementation.independent) continue;
    const entries = frameEntries.get(implementation.declaration) ?? new Map<RustFrameCallableImplementation, RustNativeFrameEntry>();
    if (entries.has(implementation)) continue;
    const type = input.frames.nativeTypeFor(implementation.carrier, input.classValues);
    if (type?.definition !== definition || type.entry !== entry) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted frame helper requires its exact physical native entry and owner.", implementation.declaration);
    const suspended = input.records.asyncFunction.get(implementation.declaration) !== undefined ||
      input.records.generator.get(implementation.declaration) !== undefined;
    const captures = implementation.captures.length + implementation.receiverFields.length + implementation.receivers.length;
    entries.set(implementation, Object.freeze({ implementation, type, suspended,
      ownerPassing: selectRustNativeFrameOwnerPassing(suspended),
      statePassing: selectRustNativeHelperStatePassing({ suspended, storage: implementation.copy ? "value" : "shared", hasPayload: captures !== 0 }),
      arguments: Object.freeze(type.environment.map(type => Object.freeze({ kind: "type" as const, type }))) }));
    frameEntries.set(implementation.declaration, entries);
    declarations.add(implementation.declaration);
  }
  for (const parameter of input.nodes) {
    if (!ast.is.IsParameterDeclaration(parameter)) continue;
    const abi = input.records.sourceParameterAbi.get(parameter);
    if (abi === undefined) continue;
    const owner = ast.parent(parameter);
    if (owner === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native parameter requires its checked callable owner.", parameter);
    const requiresImplementation = input.native.inputsFor(owner).some(selected => selected.subject.node === parameter);
    const physical = requiresImplementation ? input.nativeStorage.parameterFor(parameter) : undefined;
    if (physical?.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust",
      "An admitted native parameter requires its finalized physical callable storage.", parameter);
    const carrier = physical?.carrier ?? (input.native.isNativeRetainedParameter(parameter)
      ? closeRustRetainedCallableCarrier(abi.parameterCarrier, rustStaticLifetime) : abi.parameterCarrier);
    const parameters = sourceParameters.get(owner) ?? new Map<Node, TargetTypeRef>();
    parameters.set(parameter, carrier);
    sourceParameters.set(owner, parameters);
    declarations.add(owner);
  }
  for (const { declaration } of input.nativeProducers.producers) {
    declarations.add(declaration);
    const selected = selectRustCallableEntryGenerics({ ...input, ast }, declaration);
    if (selected.kind === "rejected") issues.push(...selected.diagnostics);
    else headers.set(declaration, selected.value);
  }
  if (issues.length !== 0) return rejectedTargetStage(Object.freeze(issues));
  const selectedHeaders = createRustCallableEntryHeaderSelections({ headers, requirements: input.requirements });
  const entryFor = createRustNativeEntryLayouts(input);
  const entries = new Map<Node, RustCallableLeadingEmission>();
  for (const node of declarations) {
    const operation = input.records.targetOperation.get(node);
    const leading = operation?.kind === "closure" ? operation.leadingParameters ?? [] : [];
    const selected = input.records.receiverIndependentMethod.get(node) === undefined ? leading : leading.filter(parameter => parameter.kind !== "this");
    const parameters = selected.map(parameter => {
      const reads: Node[] = [];
      const visit = (subject: Node): void => {
        const kind = ast.kindName(subject);
        if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
          if (rustTargetTypeRefEquals(input.records.runtimeCarrier.get(subject)?.carrier, parameter.carrier)) reads.push(subject);
          return;
        }
        if (subject !== node && (ast.is.IsFunctionExpression(subject) || ast.is.IsFunctionDeclaration(subject) ||
          ast.is.IsMethodDeclaration(subject) || ast.is.IsGetAccessorDeclaration(subject) || ast.is.IsSetAccessorDeclaration(subject) ||
          ast.is.IsClassDeclaration(subject) || ast.is.IsClassExpression(subject))) return;
        ast.forEachChild(subject, child => { if (child !== undefined) visit(child); });
      };
      if (parameter.kind === "this") visit(node);
      return Object.freeze({ ...parameter, reads: Object.freeze(reads) });
    });
    const selectedParameters = sourceParameters.get(node) ?? new Map<Node, TargetTypeRef>();
    const genericHeader = headers.get(node);
    entries.set(node, Object.freeze({ parameters: Object.freeze(parameters), genericHeader, headerSelections: selectedHeaders.readerFor(node),
      nativeEntry: entryFor(node, parameters, selectedParameters, genericHeader),
      genericEntries: snapshotTargetReadonlyMap(genericEntries.get(node) ?? []),
      frameEntries: snapshotTargetReadonlyMap(frameEntries.get(node) ?? []),
      sourceParameters: snapshotTargetReadonlyMap(selectedParameters) }));
  }
  let sealed = false;
  return resolvedTargetStage(Object.freeze({ get: (declaration: Node) => entries.get(declaration), selectHeader: selectedHeaders.select, seal() {
    if (sealed) return;
    selectedHeaders.seal();
    for (const [declaration, entry] of entries) {
      input.producer.leading(declaration, entry);
      requireRustRecord(input.required, "callableLeading", declaration, "native callable entry parameters", "prepareRustCallableEntryParameters");
    }
    sealed = true;
  } }));
}

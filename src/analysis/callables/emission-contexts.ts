import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { targetUseSiteIdentity, targetUseSiteRef, type SourceStorageQueries, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { rustLifetimeKey, type RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustFinalizedOperationAbi, RustFinalizedValueConversion } from "../../target-model/records/finalized-operation.js";
import type { RustInitializationErrorRecords } from "../../target-model/records/error-regions.js";
import type { RustCallableEmissionContexts, RustEmissionErrorContext, RustEmissionReturnDestination,
  RustEmissionProviderOperation, RustPhysicalEmissionContext, RustPhysicalEmissionOperand, RustPhysicalEmissionOperandOrigin,
  RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins, RustPhysicalEmissionRole,
  RustEmissionCallableSpecialization, RustNativeStorageBindingRequest } from "../../target-model/records/physical-emission-contexts.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustProgramErrorOwner, RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { substituteRustTargetGenericArgument, substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { closedMetadataEquals, snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustProjectConstructionPlan } from "../project-types/construction-plan.js";
import { providerSourceInputKey } from "../operations/provider-source-inputs.js";
import { rustGenericCallablePhysicalBindings, snapshotRustCallableBindings } from "./generic-bindings.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import { prepareRustFrameCallableEntrySignatures, type RustFrameCallablePlan } from "./frame-values.js";
import type { RustSuspendedCallablePlan } from "./suspended-values.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustPhysicalCallableEmissionRequest, RustPhysicalCallableStorage } from "./physical-lifecycle.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustGenericCallableCompletionPlan } from "./generic-completions.js";
import type { RustGenericCallableErrorIndex } from "./generic-errors.js";
import type { RustNativeStorageConstruction, RustNativeStoragePlan } from "./native-storage.js";
import type { RustSourceCallableSpecializationPlan } from "./specializations.js";
import type { RustProjectMethodDispatchPlan } from "../project-types/method-dispatch.js";
import type { RustLexicalFunctionQueries } from "./lexical-functions.js";
import { createRustEmissionSourceOriginPreparation,
  type RustEmissionSourceRequest } from "./emission-source-origins.js";
import type { RustNativeErrorSource } from "../../target-model/types/native-error-joins.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";
import type { RustSourceErrorRegionSelection } from "../../target-model/records/error-regions.js";
import type { RustGenericCallableInvocationFact } from "../../target-model/records/generic-callable-effects.js";
import type { RustNativeStorageSelection, RustCallablePhysicalAdapterPreparation } from "./native-storage.js";
import { prepareRustErrorRegion, type RustAnalyzedErrorRegions } from "../errors/regions.js";
import { substituteRustCallablePhysicalConversion } from "../../target-model/conversions/callable-physical.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustCallablePhysicalAdapter } from "../../target-model/records/callable-adapters.js";
import type { RustHelperCallableEmissionRequest } from "./emission-adapters.js";
import type { RustPreparedNativeDeclarationForms } from "../declarations/native-forms.js";
import type { RustPreparedNativeCaptureInput, RustPreparedNativeStorageBindingRequest } from "./emission-capture-environments.js";
import { rustNativeCaptureInputsForCreation } from "./emission-capture-environments.js";
import type { RustCallablePhysicalSignature } from "../../target-model/conversions/callable-physical.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustTypeGenericArguments } from "../../target-model/types/generic-arguments.js";
import { rustNativeFrameCallableEnvironment } from "../../policy/types/model/native-type-selection.js";


export interface RustCallableEmissionPreparationInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
  readonly sourceStorage: SourceStorageQueries;
  readonly genericBindingsFor: RustNativeStoragePlan["genericBindingsFor"];
  readonly sourceLifetimes: RustLifetimeIndex;
  readonly generic: RustGenericCallablePlan;
  readonly frames: RustFrameCallablePlan;
  readonly suspended: RustSuspendedCallablePlan;
  readonly native: RustNativeCallableInputPlan;
  readonly nativeStorage: RustPhysicalCallableStorage;
  readonly prepareCallableAdapter: RustNativeStorageConstruction["prepareCallableAdapter"];
  readonly prepareCallableField: RustPreparedNativeDeclarationForms["prepareCallableField"];
  readonly prepareStorageField: RustPreparedNativeDeclarationForms["prepareStorageField"];
  readonly frameErrorOwnerFor: (fileName: string) => Extract<RustProgramErrorOwner, { readonly kind: "physical" }> | undefined;
  readonly helperEmissionRequests: readonly RustHelperCallableEmissionRequest[];
  readonly declaredBindings: (declaration: Node) => RustTargetGenericBindings | undefined;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly genericCompletions: Pick<RustGenericCallableCompletionPlan, "forDefinition">;
  readonly genericErrors: RustGenericCallableErrorIndex<RustNativeErrorSource<TargetTypeRef>>;
  readonly declarationGenericRequirements: RustDeclarationGenericRequirementIndex;
  readonly errorRegions: Pick<RustAnalyzedErrorRegions, "get" | "sourceFor">;
  readonly initialization: RustInitializationErrorRecords<RustNativeErrorSource<TargetTypeRef>>;
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  readonly emissionRequests: readonly RustPhysicalCallableEmissionRequest[];
  readonly constructions: readonly RustProjectConstructionPlan[];
  readonly projectTypes: Pick<RustProjectTypePolicy, "openCarrier" | "relationship">;
  readonly sourceCallableSpecializations: RustSourceCallableSpecializationPlan;
  readonly projectMethodDispatch: RustProjectMethodDispatchPlan;
  readonly lexicalFunctions: RustLexicalFunctionQueries;
}

export interface RustCallableEmissionPreparation {
  readonly contexts: RustCallableEmissionContextPreparation;
  readonly physicalOperands: readonly TargetTypeRef[];
}

export interface RustPhysicalEmissionContextPreparation extends Omit<RustPhysicalEmissionContext, "targetGenericArguments" | "error" | "callableAdapters" | "nativeBindings" | "nativeEnvironments"> {
  readonly error: RustEmissionErrorContext<RustNativeErrorSource<TargetTypeRef>>;
  readonly nativeOwnerFileName: string;
  readonly callableAdapters: readonly RustCallablePhysicalAdapterPreparation[];
  readonly nativeBindingRequests: readonly RustPreparedNativeStorageBindingRequest[];
  readonly nativeCaptureInputs: readonly RustPreparedNativeCaptureInput[];
  readonly frameEntries: readonly { readonly entry: object;
    readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly error: TargetTypeRef }[];
  readonly nativeOperations: ReadonlyMap<RustFinalizedOperationAbi, {
    readonly node: Node;
    readonly arguments: readonly RustTargetGenericArgument[];
  }>;
}

export interface RustPhysicalEmissionOperandPreparation extends Omit<RustPhysicalEmissionOperand,
  "context" | "sourceErrorRegions" | "genericInvocation" | "nativeCallResult"> {
  readonly context: RustPhysicalEmissionContextPreparation;
  readonly sourceErrorRegions: readonly { readonly edge: RustSourceErrorEffectEdge;
    readonly selection: RustSourceErrorRegionSelection<RustNativeErrorSource<TargetTypeRef>> }[];
  readonly genericInvocation: RustGenericCallableInvocationFact | undefined;
  readonly nativeCallResult:
    | { readonly kind: "none" }
    | { readonly kind: "callable"; readonly carrier: TargetTypeRef }
    | { readonly kind: "frame"; readonly carrier: TargetTypeRef; readonly signature: RustCallablePhysicalSignature };
}

export interface RustCallableEmissionContextPreparation extends
  Omit<RustCallableEmissionContexts, "contexts" | "operands" | "contextFor" | "contextForOwner" | "operandFor" |
    "bodyContextFor" | "sourceErrorOperandFor"> {
  readonly contexts: readonly RustPhysicalEmissionContextPreparation[];
  readonly operands: readonly RustPhysicalEmissionOperandPreparation[];
  contextFor(use: TargetUseSiteRef): RustPhysicalEmissionContextPreparation | undefined;
  contextForOwner(subject: object, role: RustPhysicalEmissionRole): RustPhysicalEmissionContextPreparation | undefined;
  operandFor(use: TargetUseSiteRef): RustPhysicalEmissionOperandPreparation | undefined;
  bodyContextFor(enclosingUse: TargetUseSiteRef, declaration: Node): RustPhysicalEmissionContextPreparation | undefined;
  sourceErrorOperandFor(context: TargetUseSiteRef, node: Node): RustPhysicalEmissionOperandPreparation | undefined;
}

export interface RustEmissionContextRequest extends RustEmissionSourceRequest {
  readonly callableAdapterInputs: readonly (Pick<RustCallablePhysicalAdapter, "node" | "selection"> & {
    readonly origin: Exclude<RustCallablePhysicalAdapter["origin"], { readonly kind: "expression" }>;
    readonly sourceBindings: RustTargetGenericBindings;
  })[];
  readonly nativeCaptureInputs: readonly RustPreparedNativeCaptureInput[];
  readonly nativeOwnerFileName: string;
  readonly role: RustPhysicalEmissionRole;
  readonly specialization: RustEmissionCallableSpecialization;
  readonly returnDestination: RustEmissionReturnDestination;
  readonly error: RustEmissionErrorContext<RustNativeErrorSource<TargetTypeRef>>;
  readonly sourceCarriers: readonly TargetTypeRef[];
  readonly physicalCarriers: readonly TargetTypeRef[];
}

export function rustPhysicalEmissionRecordCarriers(records: RustProgramRecords, node: Node): readonly TargetTypeRef[] {
  const read = records.flowReadProjection.get(node);
  const contextual = records.contextualValueConversion.get(node);
  const lifetime = records.callScopedLifetimeReconciliation.get(node);
  const upcast = records.projectUpcast.get(node);
  const downcast = records.projectDowncast.get(node);
  const view = records.objectReferenceView.get(node);
  const option = records.optionProjection.get(node);
  const abi = records.sourceParameterAbi.get(node);
  return [records.runtimeCarrier.get(node)?.carrier, records.conversion.get(node)?.convertedType,
    read?.sourceCarrier, read?.selectedCarrier, read !== undefined && "dispatchCarrier" in read ? read.dispatchCarrier : undefined,
    contextual?.sourceCarrier, contextual?.targetCarrier, lifetime?.sourceCarrier, lifetime?.selectedCarrier,
    upcast?.sourceCarrier, upcast?.targetCarrier, downcast?.sourceCarrier, downcast?.dispatchCarrier, downcast?.targetCarrier,
    view?.sourceCarrier, view?.targetCarrier, records.indexedFieldKeyArgument.get(node)?.carrier,
    option?.sourceCarrier, option !== undefined && option.kind === "some" ? option.elementCarrier : undefined, option?.resultCarrier,
    abi?.valueCarrier, abi?.parameterCarrier].filter((carrier): carrier is TargetTypeRef => carrier !== undefined);
}

export function rustEmissionIdentityBindings(arguments_: readonly RustTargetGenericArgument[]): RustTargetGenericBindings | undefined {
  const selected = rustGenericCallablePhysicalBindings(arguments_, arguments_);
  return selected === undefined ? undefined : snapshotRustCallableBindings(selected);
}

export function rustPhysicalEmissionOperationCarriers(abi: RustFinalizedOperationAbi): readonly TargetTypeRef[] {
  const converted = (conversion: RustFinalizedValueConversion): readonly TargetTypeRef[] => [conversion.sourceCarrier, conversion.targetCarrier,
    ...(conversion.kind === "sequence" ? conversion.steps.flatMap(step => [step.sourceCarrier, step.targetCarrier]) : [])];
  return [...(abi.sourceReceiver.kind === "receiver" ? [abi.sourceReceiver.carrier, abi.sourceReceiver.declaredCarrier] : []),
    ...abi.sourceArguments.map(argument => argument.carrier),
    ...abi.targetGenericArguments.flatMap(argument => argument.kind === "type" ? [argument.type] : []),
    ...(abi.result.kind === "sync" ? [abi.result.rawCarrier, abi.result.carrier, ...converted(abi.result.conversion)]
      : [abi.result.futureCarrier, abi.result.awaitedRawCarrier, abi.result.awaitedCarrier, ...converted(abi.result.awaitedConversion)]),
    ...(abi.effects.errorCarrier === undefined ? [] : [abi.effects.errorCarrier]), ...abi.effects.nativeErrorCarriers ?? []];
}

export function rustEmissionSourceIdentity(ast: AstReader, declaration: Node): string | undefined {
  const file = ast.getSourceFile(declaration);
  const identity = sourceNodeIdentity(ast, declaration);
  return file === undefined || identity === undefined ? undefined : `${ast.getFileName(file)}:${identity}`;
}

export function prepareRustEmissionContextRequests(
  input: Pick<RustCallableEmissionPreparationInput, "ast" | "records" | "nativeStorage" | "sourceOccurrences" | "errorRegions" |
    "sourceStorage" | "genericBindingsFor" | "generic" | "emissionRequests" | "initialization" | "sourceLifetimes" | "prepareCallableAdapter" | "prepareCallableField" | "prepareStorageField" | "frameErrorOwnerFor" | "frames" | "nativeProducers">,
  selectedRequests: readonly RustEmissionContextRequest[],
): TargetStageResult<RustCallableEmissionPreparation> {
  const contexts: RustPhysicalEmissionContextPreparation[] = [];
  const operands: RustPhysicalEmissionOperandPreparation[] = [];
  const contextIndex = new Map<TargetUseSiteRef, RustPhysicalEmissionContextPreparation>();
  const ownerIndex = new Map<object, Map<RustPhysicalEmissionRole, RustPhysicalEmissionContextPreparation>>();
  const sourceOrigins = new Map<TargetUseSiteRef, ReadonlyMap<RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins>>();
  const operandIndex = new Map<object, Map<string, RustPhysicalEmissionOperandPreparation>>();
  const applications = new Map<TargetUseSiteRef, ReadonlyMap<TargetTypeRef, TargetTypeRef>>();
  const physicalOperands = new Set<TargetTypeRef>();
  const diagnostics: TargetDiagnostic[] = [];
  const requests = [...selectedRequests];
  const bodyUses = new Map<TargetUseSiteRef, Map<Node, TargetUseSiteRef>>();
  const sourceIndex = new Map<Node, Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>>();
  for (const occurrence of input.sourceOccurrences) {
    const selected = sourceIndex.get(occurrence.node) ?? new Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>();
    selected.set(occurrence.operation, occurrence);
    sourceIndex.set(occurrence.node, selected);
  }
  const requestedOwners = new Map<object, Set<RustPhysicalEmissionRole>>();
  for (const request of requests) {
    if (!Array.isArray(request.demands)) throw new Error("An emitted context requires its original selected demand rows, not a native-node inventory.");
    if (request.source === undefined) throw new Error("An emitted context requires its original selected source owner.");
    if (request.use.role !== request.role) throw new Error("An emitted context requires its exact finite selected role.");
    const roles = requestedOwners.get(request.use.subject) ?? new Set<RustPhysicalEmissionRole>();
    if (roles.has(request.role)) diagnostics.push(emissionDiagnostic(request.declaration,
      "One original emitted owner and role requires exactly one selected physical context."));
    roles.add(request.role);
    requestedOwners.set(request.use.subject, roles);
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  const nativeBodies = new Map(requests.filter(request => request.role === "native-body")
    .map(request => [request.declaration, request] as const));
  const frameSignatures = prepareRustFrameCallableEntrySignatures({ frames: input.frames,
    nativeProducers: input.nativeProducers, bodyBindingsFor: declaration => nativeBodies.get(declaration)?.bindings,
    errorOwnerFor: input.frameErrorOwnerFor });
  if (frameSignatures.kind === "rejected") return frameSignatures;
  const selectedDemands = new Set(input.emissionRequests);
  const creationOwners = new Map<TargetUseSiteRef, ReadonlySet<Node>>();
  for (let index = 0; index < requests.length; index += 1) {
    const enclosing = requests[index]!;
    const bodies = new Map<Node, TargetUseSiteRef>();
    if (enclosing.role === "native-body" && input.records.closureCapture.get(enclosing.declaration)?.invocationOwner === "shared-state")
      bodies.set(enclosing.declaration, enclosing.use);
    const ancestors = creationOwners.get(enclosing.use) ?? new Set([enclosing.declaration]);
    for (const demand of enclosing.demands) {
      if (demand.kind !== "type" || demand.context.role !== "inline-body") continue;
      const layer = enclosing.source.kind === "construction" ? enclosing.source.layer : undefined;
      const owns = layer === undefined ? demand.owner === enclosing.declaration
        : demand.owner === layer.definition.declaration || demand.owner === layer.constructor;
      if (!selectedDemands.has(demand) || !owns || demand.context.subject !== demand.subject) {
        diagnostics.push(emissionDiagnostic(demand.subject, "An inline body requires its exact original selecting creation owner and occurrence."));
        continue;
      }
      if (bodies.has(demand.subject)) continue;
      const original = nativeBodies.get(demand.subject);
      if (original === undefined || ancestors.has(demand.subject)) {
        diagnostics.push(emissionDiagnostic(demand.subject, "An inline body requires one complete acyclic original native body selection."));
        continue;
      }
      const parameters = input.sourceLifetimes.contractFor(demand.subject)?.parameters ?? [];
      const ownTypes = new Set(parameters.flatMap(parameter => parameter.kind === "type" ? [parameter.identity] : []));
      const ownLifetimes = new Set(parameters.flatMap(parameter => parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : []));
      const types = new Map([...original.bindings.types].map(([identity, carrier]) => [identity, ownTypes.has(identity) ? carrier
        : substituteRustTargetGenerics(carrier, enclosing.bindings.types, enclosing.bindings.lifetimes, enclosing.bindings.consts)]));
      const lifetimes = new Map([...original.bindings.lifetimes].map(([identity, lifetime]) => [identity, ownLifetimes.has(identity) ? lifetime
        : enclosing.bindings.lifetimes.get(rustLifetimeKey(lifetime)) ?? lifetime]));
      const consts = new Map(original.bindings.consts);
      for (const [identity, value] of consts) {
        const selected = substituteRustTargetGenericArgument({ kind: "const", value }, enclosing.bindings.types,
          enclosing.bindings.lifetimes, enclosing.bindings.consts);
        if (selected.kind !== "const") {
          diagnostics.push(emissionDiagnostic(demand.subject, "An inline native const argument lost its original argument kind."));
          continue;
        }
        consts.set(identity, selected.value);
      }
      const subject = Object.freeze({ declaration: demand.subject, enclosingUse: enclosing.use });
      const use = targetUseSiteRef(subject, "native-body", `${targetUseSiteIdentity(enclosing.use)}:${targetUseSiteIdentity(original.use)}`);
      const selected: RustEmissionContextRequest = { ...original, use,
        nativeCaptureInputs: rustNativeCaptureInputsForCreation(original.nativeCaptureInputs, enclosing.use),
        bindings: snapshotRustCallableBindings({ types, lifetimes, consts }),
        sourceCarriers: [...original.sourceCarriers, ...original.physicalCarriers], physicalCarriers: [] };
      requests.push(selected);
      bodies.set(demand.subject, use);
      creationOwners.set(use, new Set([...ancestors, demand.subject]));
    }
    bodyUses.set(enclosing.use, bodies);
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  const prepareSourceOrigins = createRustEmissionSourceOriginPreparation({ ...input, physical: input.generic.physical }, requests);
  for (const request of requests) {
    const carriers = new Set<TargetTypeRef>();
    const applied = new Map<TargetTypeRef, TargetTypeRef>();
    const apply = (source: TargetTypeRef): TargetTypeRef => {
      const existing = applied.get(source);
      if (existing !== undefined) return existing;
      const selected = substituteRustTargetGenerics(source, request.bindings.types, request.bindings.lifetimes, request.bindings.consts);
      const result = selected === source ? source : snapshotClosedMetadata(selected);
      applied.set(source, result);
      applied.set(result, result);
      carriers.add(result);
      physicalOperands.add(result);
      return result;
    };
    for (const carrier of request.physicalCarriers) {
      applied.set(carrier, carrier);
      carriers.add(carrier);
      physicalOperands.add(carrier);
    }
    for (const carrier of request.sourceCarriers) apply(carrier);
    const returnDestination: RustEmissionReturnDestination = request.returnDestination.kind === "none" ? request.returnDestination
      : Object.freeze({ ...request.returnDestination, carrier: apply(request.returnDestination.carrier) });
    const contextCarriers: TargetTypeRef[] = [];
    const contextOrigins: RustPhysicalEmissionSourceOrigins[] = [];
    const contextAdapters: RustCallablePhysicalAdapterPreparation[] = [];
    const nativeBindingRequests: RustPreparedNativeStorageBindingRequest[] = [];
    const frameEntries = request.role !== "frame" ? [] : frameSignatures.value.filter(row => row.frame === request.use.subject)
      .map(row => Object.freeze({ entry: row.entry, parameters: Object.freeze(row.signature.parameters.map(apply)),
        result: apply(row.signature.result), error: apply(row.signature.error) }));
    const retainAdapter = (selected: RustCallablePhysicalAdapterPreparation): void => {
      const existing = contextAdapters.find(row => row.node === selected.node && row.selection === selected.selection);
      if (existing !== undefined && (existing.joinOwnerFileName !== selected.joinOwnerFileName ||
        !sameAdapterOrigin(existing.origin, selected.origin) || !samePreparedAdapterSource(existing.source, selected.source) ||
        !closedMetadataEquals(existing.conversion, selected.conversion)))
        diagnostics.push(emissionDiagnostic(selected.node,
          "One physical helper boundary requires its exact original source slot and complete selected conversion."));
      else if (existing === undefined) contextAdapters.push(selected);
    };
    const nativeCallResultFor = (node: Node): RustPhysicalEmissionOperandPreparation["nativeCallResult"] => {
      const invocations = request.demands.filter((demand): demand is Extract<RustPhysicalCallableEmissionRequest, { readonly kind: "invocation" }> =>
        demand.kind === "invocation" && demand.subject === node);
      if (invocations.length === 0 || invocations.every(demand => demand.callableKind === "generic")) return Object.freeze({ kind: "none" });
      if (!invocations.every(demand => demand.callableKind === "retained")) {
        diagnostics.push(emissionDiagnostic(node, "One original invocation requires one consistent admitted callable ABI class."));
        return Object.freeze({ kind: "none" });
      }
      const storage = input.nativeStorage.invocationCallableFor(node);
      if (storage.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(node, storage.reason));
        return Object.freeze({ kind: "none" });
      }
      const carrier = apply(storage.carrier);
      if (rustFrameCallableValue(storage.carrier) === undefined) return Object.freeze({ kind: "callable", carrier });
      const environment = rustNativeFrameCallableEnvironment(storage.carrier, input.frames);
      const rows = environment === undefined ? [] : frameSignatures.value.filter(row =>
        row.frame === environment.definition && row.entry === environment.entry);
      const bindings = environment === undefined ? undefined : rustGenericCallablePhysicalBindings(
        rustTypeGenericArguments(environment.definition.environmentParameters), rustTypeGenericArguments(environment.environment));
      if (rows.length !== 1 || bindings === undefined) {
        diagnostics.push(emissionDiagnostic(node,
          "A frame invocation requires its original one entry ABI and complete correlated native environment."));
        return Object.freeze({ kind: "none" });
      }
      const bind = (type: TargetTypeRef): TargetTypeRef => apply(substituteRustTargetGenerics(type,
        bindings.types, bindings.lifetimes, bindings.consts));
      const signature = rows[0]!.signature;
      return Object.freeze({ kind: "frame", carrier, signature: Object.freeze({
        parameters: Object.freeze(signature.parameters.map(bind)), result: bind(signature.result), error: bind(signature.error) }) });
    };
    const nativeOperations = new Map<RustFinalizedOperationAbi, { readonly node: Node; readonly arguments: readonly RustTargetGenericArgument[] }>();
    const nativeOperation = (node: Node, abi: RustFinalizedOperationAbi): void => {
      if (nativeOperations.has(abi)) return;
      const arguments_ = abi.targetGenericArguments.map(argument => argument.kind === "type"
        ? Object.freeze({ kind: "type" as const, type: apply(argument.type) })
        : substituteRustTargetGenericArgument(argument, request.bindings.types, request.bindings.lifetimes, request.bindings.consts));
      nativeOperations.set(abi, Object.freeze({ node, arguments: Object.freeze(arguments_) }));
    };
    const error = request.error.kind === "region"
      ? Object.freeze({ ...request.error, region: prepareRustErrorRegion(request.error.region, apply) }) : request.error;
    const context: RustPhysicalEmissionContextPreparation = { use: request.use, role: request.role,
      specialization: request.specialization, declaration: request.declaration,
      nativeOwnerFileName: request.nativeOwnerFileName, nativeOperations,
      bindings: request.bindings, returnDestination, error, operands: contextCarriers, sourceOrigins: contextOrigins,
      callableAdapters: contextAdapters, nativeBindingRequests, nativeCaptureInputs: request.nativeCaptureInputs,
      frameEntries: Object.freeze(frameEntries) };
    for (const adapter of request.callableAdapterInputs) {
      const prepared = input.prepareCallableAdapter(adapter.node, adapter.selection, adapter.origin,
        adapter.sourceBindings, request.nativeOwnerFileName,
        { use: request.use, prepareCallableField: input.prepareCallableField,
          frameSignatureFor: (binding, boundFrameCarrier, bindings) => {
            const expected = substituteRustTargetGenerics(binding.carrier, bindings.types, bindings.lifetimes, bindings.consts);
            const rows = frameSignatures.value.filter(row => row.entry === binding.entry && row.frame.bindings.includes(binding));
            if (!rustTargetTypeRefEquals(expected, boundFrameCarrier) || rows.length !== 1)
              return rejectedTargetStage([emissionDiagnostic(binding.declaration,
                "A generated field adaptation requires its exact original frame entry and correlated bound carrier.")]);
            const signature = rows[0]!.signature;
            const selected = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(carrier,
              bindings.types, bindings.lifetimes, bindings.consts);
            return resolvedTargetStage(Object.freeze({ parameters: Object.freeze(signature.parameters.map(selected)),
              result: selected(signature.result), error: selected(signature.error) }));
          } });
      if (prepared.kind === "rejected") { diagnostics.push(...prepared.diagnostics); continue; }
      retainAdapter(prepared.value);
      const retain = (selected: RustCallablePhysicalAdapterPreparation["conversion"]): void => {
        for (const carrier of [selected.carrier, ...selected.parameters, selected.result, selected.error,
          ...selected.source.parameters, selected.source.result, selected.source.error, ...selected.errors.map(source => source.errorType)]) {
          physicalOperands.add(carrier);
          carriers.add(carrier);
        }
        for (const part of [...selected.arguments, selected.resultPlan]) if (part.kind === "callable") retain(part.conversion);
      };
      retain(prepared.value.conversion);
      if (prepared.value.source.kind === "selected") {
        physicalOperands.add(prepared.value.source.carrier);
        carriers.add(prepared.value.source.carrier);
      }
    }
    const add = (node: Node, origin: RustPhysicalEmissionOperandOrigin, source: TargetTypeRef,
      destination: TargetTypeRef | undefined, endpoints: readonly TargetTypeRef[],
      storage: Exclude<RustNativeStorageSelection, { readonly kind: "unresolved" }>, inputOrdinal?: number,
      binding?: { readonly declaration: Node; readonly logicalCarrier: TargetTypeRef;
        readonly source: Exclude<RustNativeStorageBindingRequest["source"], { readonly kind: "capture" }> }): void => {
      const sourceError = origin.kind === "operand" && origin.evaluation.kind === "ordinary" && origin.evaluation.site.role === "source-errors";
      const role = sourceError ? "source-error"
        : origin.kind === "call-input" ? `call-input:${providerSourceInputKey(origin.input)}:${inputOrdinal}`
        : origin.evaluation.kind === "ordinary" ? `${origin.kind}:${targetUseSiteIdentity(origin.evaluation.site)}` : origin.kind;
      const subject = sourceError ? node : origin.kind === "call-input" ? origin.input
        : origin.evaluation.kind === "provider-source" ? origin.evaluation.slot : origin.evaluation.site.subject;
      const use = targetUseSiteRef(subject, role,
        sourceError ? targetUseSiteIdentity(request.use) : request.use.enclosingContract, request.use.role);
      const values = new Map<TargetTypeRef, TargetTypeRef>();
      for (const endpoint of [source, ...endpoints, ...destination === undefined ? [] : [destination]]) {
        const carrier = apply(endpoint);
        values.set(endpoint, carrier);
        values.set(carrier, carrier);
      }
      const sourceErrorRegions: RustPhysicalEmissionOperandPreparation["sourceErrorRegions"][number][] = [];
      let genericInvocation: RustGenericCallableInvocationFact | undefined;
      for (const adapter of storage.callableAdapters) {
        if (adapter.node !== node) continue;
        retainAdapter(Object.freeze({ ...adapter, source: adapter.source.kind === "selected"
          ? Object.freeze({ ...adapter.source, carrier: apply(adapter.source.carrier) }) : adapter.source,
          conversion: substituteRustCallablePhysicalConversion(adapter.conversion, request.bindings, apply) }));
      }
      if (sourceError) {
        const edges = new Set([...(input.records.sourceErrorEffects.get(node)?.edges ?? []),
          ...(input.records.awaitSourceErrorEffects.get(node)?.branches.map(branch => branch.edge) ?? [])]);
        for (const edge of edges) {
          const selected = input.errorRegions.sourceFor(edge);
          if (selected === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted source call has no selected native error correspondence."));
          else sourceErrorRegions.push(Object.freeze({ edge,
            selection: Object.freeze({ ...selected, operand: prepareRustErrorRegion(selected.operand, apply) }) }));
        }
        const invocation = input.records.genericCallableInvocation.get(node);
        if (invocation !== undefined) genericInvocation = Object.freeze({ ...invocation, carrier: apply(invocation.carrier),
          invocation: Object.freeze(invocation.invocation.map(source => Object.freeze({ ...source, errorType: apply(source.errorType) }))),
          awaiting: Object.freeze(invocation.awaiting.map(source => Object.freeze({ ...source, errorType: apply(source.errorType) }))) });
      }
      const operand = Object.freeze({ use, node, context, origin, carrier: apply(source),
        destination: destination === undefined ? undefined : apply(destination), sourceErrorRegions: Object.freeze(sourceErrorRegions),
        genericInvocation, nativeCallResult: sourceError ? nativeCallResultFor(node) : Object.freeze({ kind: "none" as const }) });
      operands.push(operand);
      const indexed = operandIndex.get(use.subject) ?? new Map<string, RustPhysicalEmissionOperandPreparation>();
      indexed.set(targetUseSiteIdentity(use), operand);
      operandIndex.set(use.subject, indexed);
      applications.set(use, values);
      if (binding !== undefined) nativeBindingRequests.push(Object.freeze({ use, declaration: binding.declaration,
        logicalCarrier: binding.logicalCarrier, physicalCarrier: operand.carrier, sourceBindings: request.bindings,
        source: binding.source }));
    };
    const nodes = [...new Set(request.demands.map(demand => demand.subject))];
    const occurrences = nodes.flatMap(node => [...sourceIndex.get(node)?.values() ?? []]);
    const origins = new Map<RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins>();
    for (const occurrence of occurrences) {
      const selected = prepareSourceOrigins(request, occurrence);
      contextOrigins.push(selected);
      origins.set(occurrence, selected);
    }
    sourceOrigins.set(request.use, origins);
    const sourceSlots = new Set<object>(occurrences.flatMap(occurrence => occurrence.slots));
    for (const occurrence of occurrences) {
      for (const carrier of rustPhysicalEmissionOperationCarriers(occurrence.operation.abi)) apply(carrier);
      nativeOperation(occurrence.node, occurrence.operation.abi);
    }
    for (const node of nodes) {
      const resource = input.records.resourceManagement.get(node)?.disposal.target;
      if (resource?.form !== "provider") continue;
      for (const carrier of rustPhysicalEmissionOperationCarriers(resource.abi)) apply(carrier);
      nativeOperation(node, resource.abi);
    }
    for (const demand of request.demands) {
      if (demand.kind === "type") {
        const physicalCarrier = apply(demand.carrier);
        if (demand.context.role === "class-environment") {
          const sourceFile = input.ast.getSourceFile(demand.subject);
          if (sourceFile === undefined || request.role !== "module-initializer" || request.declaration !== sourceFile)
            diagnostics.push(emissionDiagnostic(demand.subject,
              "A generated class environment requires its exact selected module initializer context."));
          else nativeBindingRequests.push(Object.freeze({ use: request.use, declaration: demand.subject,
            logicalCarrier: demand.carrier, physicalCarrier, sourceBindings: request.bindings,
            source: Object.freeze({ kind: "module", sourceFile, initialization: "ready" }) }));
        }
        continue;
      }
      if (demand.kind === "producer") continue;
      const node = demand.subject;
      const selected = demand.kind === "value" ? input.nativeStorage.valueFor(node)
        : demand.kind === "operand" ? input.nativeStorage.operandFor(node)
        : demand.kind === "return" ? input.nativeStorage.returnFor(node)
        : input.nativeStorage.invocationCallableFor(node);
      if (selected.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(node, selected.reason));
        continue;
      }
      if (demand.kind === "return" || demand.kind === "invocation") {
        apply(selected.carrier);
        continue;
      }
      if (sourceSlots.has(demand.context.subject)) continue;
      const endpoints = rustPhysicalEmissionRecordCarriers(input.records, node);
      const destination = input.records.contextualValueConversion.get(node)?.targetCarrier;
      const evaluation = Object.freeze({ kind: "ordinary" as const, site: demand.context });
      if (demand.kind === "operand" && demand.context.role === "source-errors") {
        const value = input.nativeStorage.valueFor(node);
        if (value.kind === "unresolved") diagnostics.push(emissionDiagnostic(node, value.reason));
        else add(node, Object.freeze({ kind: "operand", evaluation }), selected.carrier, destination, endpoints, value);
      } else {
        let binding: { readonly declaration: Node; readonly logicalCarrier: TargetTypeRef;
          readonly source: Exclude<RustNativeStorageBindingRequest["source"], { readonly kind: "capture" }> } | undefined;
        if (demand.kind === "value" && (demand.context.role === "binding" || demand.context.role === "module-binding")) {
          const projection = input.records.bindingProjection.get(node);
          const logicalCarrier = projection === undefined ? input.records.runtimeCarrier.get(node)?.carrier
            : "bindingCarrier" in projection ? projection.bindingCarrier : undefined;
          if (logicalCarrier === undefined) diagnostics.push(emissionDiagnostic(node,
            "An emitted binding requires its original declared logical carrier before native storage publication."));
          else if (demand.context.role === "module-binding") {
            const sourceFile = input.ast.getSourceFile(node);
            if (sourceFile === undefined || request.role !== "module-initializer" || request.declaration !== sourceFile)
              diagnostics.push(emissionDiagnostic(node,
                "A static native field requires its exact selected module initializer context."));
            else binding = { declaration: node, logicalCarrier,
              source: Object.freeze({ kind: "module", sourceFile, initialization: "ready" }) };
          } else binding = { declaration: node, logicalCarrier, source: Object.freeze({ kind: "binding" }) };
        }
        add(node, Object.freeze({ kind: demand.kind, evaluation }), selected.carrier, destination, endpoints, selected, undefined, binding);
      }
    }
    for (const occurrence of occurrences) for (const slot of occurrence.slots) {
      const value = input.nativeStorage.valueFor(slot.node);
      const operand = input.nativeStorage.operandFor(slot.node);
      if (value.kind === "unresolved" || operand.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(slot.node, value.kind === "unresolved" ? value.reason
          : operand.kind === "unresolved" ? operand.reason : "Missing prepared provider source storage."));
        continue;
      }
      const evaluation = Object.freeze({ kind: "provider-source" as const, slot });
      const endpoints = [slot.source.row.carrier, ...rustPhysicalEmissionRecordCarriers(input.records, slot.node)];
      const destination = input.records.contextualValueConversion.get(slot.node)?.targetCarrier;
      add(slot.node, Object.freeze({ kind: "value", evaluation }), value.carrier, destination, endpoints, value);
      add(slot.node, Object.freeze({ kind: "operand", evaluation }), operand.carrier, destination, endpoints, operand);
    }
    for (const occurrence of occurrences) for (const [ordinal, { input: value, slot }] of occurrence.inputs.entries()) {
      const source = input.nativeStorage.operandFor(slot.node);
      if (source.kind === "unresolved") {
        diagnostics.push(emissionDiagnostic(slot.node, source.reason));
        continue;
      }
      add(slot.node, Object.freeze({ kind: "call-input", operationNode: occurrence.node, operation: occurrence.operation, input: value }),
        source.carrier, value.parameterCarrier, [value.sourceCarrier, value.conversion.sourceCarrier, value.conversion.targetCarrier,
          ...(value.conversion.kind === "sequence" ? value.conversion.steps.flatMap(step => [step.sourceCarrier, step.targetCarrier]) : []),
          ...rustPhysicalEmissionRecordCarriers(input.records, slot.node)], source, ordinal);
    }
    if (request.error.kind === "region") {
      for (const source of request.error.region.sources) apply(source.errorType);
      for (const carrier of request.error.region.jsRejection?.requiredCarriers ?? []) apply(carrier);
    }
    for (const captureInput of request.nativeCaptureInputs) for (const { slot, slotIndex } of captureInput.slots) {
      const capture = slot.capture;
      const declaration = slot.kind === "receiver" ? slot.capture.owner : slot.capture.declaration;
      const selected = input.nativeStorage.valueFor(capture.reference);
      if (selected.kind === "unresolved") { diagnostics.push(emissionDiagnostic(capture.reference, selected.reason)); continue; }
      const physicalCarrier = apply(selected.carrier);
      nativeBindingRequests.push(Object.freeze({ use: request.use, declaration,
        logicalCarrier: capture.carrier, physicalCarrier, sourceBindings: request.bindings,
        source: Object.freeze({ kind: "capture", input: captureInput, slot, slotIndex,
          initialization: slot.kind === "binding"
            ? input.records.bindingStorage.get(declaration)?.initialization ?? "ready" : "ready" }) }));
    }
    if (request.role === "frame") {
      const frame = input.frames.definitionForOwner(request.declaration);
      if (frame === undefined || request.use.subject !== frame) diagnostics.push(emissionDiagnostic(request.declaration,
        "Native frame binding publication requires its exact original complete frame owner."));
      else for (const binding of frame.bindings) {
        let physicalCarrier: TargetTypeRef;
        if (binding.entry !== undefined) physicalCarrier = apply(binding.carrier);
        else {
          const selected = input.records.sourceParameterAbi.get(binding.declaration) === undefined
            ? input.nativeStorage.valueFor(binding.declaration) : input.nativeStorage.parameterFor(binding.declaration);
          if (selected.kind === "unresolved") { diagnostics.push(emissionDiagnostic(binding.declaration, selected.reason)); continue; }
          physicalCarrier = apply(selected.carrier);
        }
        nativeBindingRequests.push(Object.freeze({ use: request.use, declaration: binding.declaration,
          logicalCarrier: binding.carrier, physicalCarrier, sourceBindings: request.bindings,
          source: Object.freeze({ kind: "binding" }) }));
      }
    }
    if (request.source.kind === "construction")
      for (const field of request.source.layer === undefined ? request.source.plan.fields : request.source.layer.fields) {
        if (field.externallyInitialized) continue;
        const selected = input.prepareStorageField({ use: request.use, node: field.declaration, field,
          construction: request.source.plan, layer: request.source.layer,
          sourceBindings: request.bindings, nativeOwnerFileName: request.nativeOwnerFileName });
        if (selected.kind === "rejected") diagnostics.push(...selected.diagnostics);
        else {
          apply(selected.value.physicalCarrier);
          nativeBindingRequests.push(selected.value);
        }
      }
    contextCarriers.push(...carriers);
    Object.freeze(contextCarriers);
    Object.freeze(contextOrigins);
    Object.freeze(contextAdapters);
    Object.freeze(nativeBindingRequests);
    Object.freeze(nativeOperations);
    Object.freeze(context);
    contexts.push(context);
    contextIndex.set(request.use, context);
    const owner = ownerIndex.get(request.use.subject) ?? new Map<RustPhysicalEmissionRole, RustPhysicalEmissionContextPreparation>();
    owner.set(request.role, context);
    ownerIndex.set(request.use.subject, owner);
    applications.set(request.use, applied);
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  return resolvedTargetStage(Object.freeze({ physicalOperands: Object.freeze([...physicalOperands]),
    contexts: Object.freeze({ contexts: Object.freeze(contexts), operands: Object.freeze(operands), sourceOccurrences: input.sourceOccurrences,
      contextFor: (use: TargetUseSiteRef) => contextIndex.get(use),
      contextForOwner: (subject: object, role: RustPhysicalEmissionRole) => ownerIndex.get(subject)?.get(role),
      bodyContextFor: (enclosingUse: TargetUseSiteRef, declaration: Node) => {
        const use = bodyUses.get(enclosingUse)?.get(declaration);
        return use === undefined ? undefined : contextIndex.get(use);
      },
      operandFor: (use: TargetUseSiteRef) => applications.has(use) ? operandIndex.get(use.subject)?.get(targetUseSiteIdentity(use)) : undefined,
      sourceErrorOperandFor: (context: TargetUseSiteRef, node: Node) => contextIndex.has(context)
        ? operandIndex.get(node)?.get(targetUseSiteIdentity(
          { role: "source-error", enclosingContract: targetUseSiteIdentity(context), specialization: context.role })) : undefined,
      carrierFor: (use: TargetUseSiteRef, source: TargetTypeRef) => applications.get(use)?.get(source),
      sourceOriginFor: (use: TargetUseSiteRef, occurrence: RustPhysicalEmissionSourceOccurrence) => sourceOrigins.get(use)?.get(occurrence),
      sourceFor: (node: Node, operation: RustEmissionProviderOperation) => sourceIndex.get(node)?.get(operation) }) }));
}

export function emissionDiagnostic(node: Node, message: string): TargetDiagnostic {
  return { code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust",
    sourceNode: node, message, evidence: ["rust.callable-value.physical-emission-context"] };
}

function sameAdapterOrigin(left: RustCallablePhysicalAdapter["origin"], right: RustCallablePhysicalAdapter["origin"]): boolean {
  switch (left.kind) {
    case "expression": return right.kind === "expression" && left.subject === right.subject;
    case "parameter": return right.kind === "parameter" && left.abi === right.abi;
    case "return": return right.kind === "return" && left.declaration === right.declaration;
    case "field": return right.kind === "field" && left.selection === right.selection;
  }
}

function samePreparedAdapterSource(left: RustCallablePhysicalAdapterPreparation["source"],
  right: RustCallablePhysicalAdapterPreparation["source"]): boolean {
  return left.kind === "field" ? right.kind === "field" && left.preparation === right.preparation
    : right.kind === "selected" && left.input === right.input && rustTargetTypeRefEquals(left.carrier, right.carrier);
}

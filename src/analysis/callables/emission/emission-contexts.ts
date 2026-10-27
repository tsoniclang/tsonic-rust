import { sealRustCallableEmissionContexts } from "../../program/records/native/physical-emission-contexts.js";
import type { AstReader, Node } from "@tsonic/tsts";
import { targetUseSiteIdentity, targetUseSiteRef, type SourceStorageQueries, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustFinalizedOperationAbi, RustFinalizedValueConversion } from "../../../target-model/records/operations/finalized-operation.js";
import type { RustErrorRegionRecords, RustInitializationErrorRecords } from "../../../target-model/records/errors/error-regions.js";
import type { RustCallableEmissionContexts, RustEmissionErrorContext, RustEmissionReturnDestination, RustEmissionProviderOperation, RustPhysicalEmissionContext, RustPhysicalEmissionOperand, RustPhysicalEmissionOperandOrigin, RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins, RustPhysicalEmissionSourceSlot } from "../../../target-model/records/native/physical-emission-contexts.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../../target-model/types/model.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import type { RustProjectTypePolicy } from "../../../target-model/types/project-types.js";
import type { RustDeclarationGenericRequirementIndex } from "../../declarations/generic-requirements.js";
import type { RustProjectConstructionPlan } from "../../project-types/construction-plan.js";
import { providerSourceInputKey } from "../../operations/provider-source-inputs.js";
import { rustGenericCallablePhysicalBindings, snapshotRustCallableBindings } from "../../../policy/types/callables/generic-bindings.js";
import type { RustGenericCallablePlan } from "../generics/generic-values.js";
import type { RustFrameCallablePlan } from "../../../target-model/records/callables/frame-callables.js";
import type { RustSuspendedCallablePlan } from "../../../target-model/records/callables/suspended-callables.js";
import type { RustNativeCallableInputPlan } from "../native/native-inputs.js";
import type { RustPhysicalCallableEmissionRequest } from "../ownership/physical-lifecycle.js";
import type { RustPhysicalCallableStorage } from "../../../target-model/records/native/native-storage.js";
import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native/native-producers.js";
import type { RustGenericCallableCompletionPlan } from "../generics/generic-completions.js";
import type { RustGenericCallableErrorIndex } from "../../../target-model/records/callables/generic-callable-errors.js";
import type { RustNativeStoragePlan } from "../storage/native-storage.js";
import { createRustEmissionSourceOriginPreparation, type RustEmissionSourceOwner, type RustEmissionSourceRequest } from "./emission-source-origins.js";

export interface RustCallableEmissionPreparationInput {
  readonly ast: AstReader;
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
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly genericCompletions: Pick<RustGenericCallableCompletionPlan, "forDefinition">;
  readonly genericErrors: RustGenericCallableErrorIndex;
  readonly declarationGenericRequirements: RustDeclarationGenericRequirementIndex;
  readonly errorRegions: Pick<RustErrorRegionRecords, "get" | "sourceFor">;
  readonly initialization: RustInitializationErrorRecords;
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  readonly emissionRequests: readonly RustPhysicalCallableEmissionRequest[];
  readonly constructions: readonly RustProjectConstructionPlan[];
  readonly projectTypes: Pick<RustProjectTypePolicy, "openCarrier" | "relationship">;
}

export interface RustCallableEmissionPreparation {
  readonly contexts: RustCallableEmissionContexts;
  readonly physicalOperands: readonly TargetTypeRef[];
}

export interface RustEmissionContextRequest extends RustEmissionSourceRequest {
  readonly returnDestination: RustEmissionReturnDestination;
  readonly error: RustEmissionErrorContext;
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
  const caught = records.catchBinding.get(node);
  return [records.runtimeCarrier.get(node)?.carrier, records.conversion.get(node)?.convertedType,
    read?.sourceCarrier, read?.selectedCarrier, read !== undefined && "dispatchCarrier" in read ? read.dispatchCarrier : undefined,
    contextual?.sourceCarrier, contextual?.targetCarrier, lifetime?.sourceCarrier, lifetime?.selectedCarrier,
    upcast?.sourceCarrier, upcast?.targetCarrier, downcast?.sourceCarrier, downcast?.dispatchCarrier, downcast?.targetCarrier,
    view?.sourceCarrier, view?.targetCarrier, records.indexedFieldKeyArgument.get(node)?.carrier,
    option?.sourceCarrier, option !== undefined && option.kind === "some" ? option.elementCarrier : undefined, option?.resultCarrier,
    abi?.valueCarrier, abi?.parameterCarrier, caught?.inputCarrier, caught?.readCarrier]
    .filter((carrier): carrier is TargetTypeRef => carrier !== undefined);
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
    ...(abi.effects.errorCarrier === undefined ? [] : [abi.effects.errorCarrier]), ...abi.effects.nativeErrorCarriers ?? [],
    // A typed None constant input renders its payload type (`Option::<i32>::None`).
    ...abi.targetArguments.flatMap(input => {
      const source = input.source;
      return source.kind === "constant" && source.value.kind === "none" && source.value.element !== undefined ? [source.value.element] : [];
    })];
}

export function rustEmissionSourceIdentity(ast: AstReader, declaration: Node): string | undefined {
  const file = ast.getSourceFile(declaration);
  const identity = sourceNodeIdentity(ast, declaration);
  return file === undefined || identity === undefined ? undefined : `${ast.getFileName(file)}:${identity}`;
}

export function prepareRustCallableEmissionContexts(
  input: RustCallableEmissionPreparationInput,
): TargetStageResult<RustCallableEmissionPreparation> {
  if (!Array.isArray(input.emissionRequests)) failTargetAnalysisInvariant("tsonic-rust", "Physical emission requires its complete selecting-owner request vector.");
  const requests: RustEmissionContextRequest[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  const byOwner = new Map<Node, RustPhysicalCallableEmissionRequest[]>();
  const ownerBindings = new Map<Node, RustTargetGenericBindings>();
  for (const demand of input.emissionRequests) {
    const bindings = ownerBindings.get(demand.owner);
    if (bindings !== undefined && bindings !== demand.bindings)
      diagnostics.push(emissionDiagnostic(demand.subject, "One original emitted source owner requires one canonical immutable binding input."));
    else ownerBindings.set(demand.owner, demand.bindings);
    const demands = byOwner.get(demand.owner) ?? [];
    demands.push(demand);
    byOwner.set(demand.owner, demands);
  }
  const declaredBindings = (declaration: Node): RustTargetGenericBindings | undefined => {
    const existing = ownerBindings.get(declaration);
    if (existing !== undefined) return existing;
    const contract = input.sourceLifetimes.contractFor(declaration);
    if (contract === undefined && input.records.sourceCallableReturn.get(declaration) !== undefined &&
      input.ast.typeParameters(declaration).length !== 0) return undefined;
    const arguments_: RustTargetGenericArgument[] = (contract?.parameters ?? []).map(parameter => parameter.kind === "lifetime"
      ? { kind: "lifetime", lifetime: parameter.lifetime }
      : { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } });
    const bindings = rustEmissionIdentityBindings(arguments_);
    if (bindings !== undefined) ownerBindings.set(declaration, bindings);
    return bindings;
  };
  const request = (subject: object, role: string, declaration: Node, identity: string,
    bindings: RustTargetGenericBindings | undefined, demands: readonly RustPhysicalCallableEmissionRequest[], source: RustEmissionSourceOwner,
    sourceCarriers: readonly TargetTypeRef[],
    physicalCarriers: readonly TargetTypeRef[] = [], physicalReturn: TargetTypeRef | undefined = undefined): void => {
    if (bindings === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "An emitted native context has no exact canonical type, lifetime and const bindings."));
      return;
    }
    const returned = input.records.sourceCallableReturn.get(declaration);
    const generator = input.records.generator.get(declaration);
    // A declaration without a body (an interface call signature) stores no returned value; its destination is the
    // declared return carrier, not a native storage selection.
    const bodiless = input.ast.body(declaration) === undefined;
    const selected = returned === undefined || physicalReturn !== undefined || generator !== undefined || bodiless
      ? undefined : input.nativeStorage.returnFor(declaration);
    if (selected?.kind === "unresolved") {
      diagnostics.push(selected.diagnostic ?? emissionDiagnostic(declaration, selected.reason));
      return;
    }
    const region = input.errorRegions.get(declaration);
    if (region === undefined && input.records.errorEffects.get(declaration) !== undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "An emitted callable has no selected native error region."));
      return;
    }
    const returnDestination: RustEmissionReturnDestination = physicalReturn !== undefined
      ? Object.freeze({ kind: "value", carrier: physicalReturn, borrowedParameter: returned?.borrowedParameter })
      : generator !== undefined ? Object.freeze({ kind: "value", carrier: generator.returnType, borrowedParameter: undefined })
      : bodiless && returned !== undefined
        ? Object.freeze({ kind: "value", carrier: returned.returnCarrier, borrowedParameter: returned.borrowedParameter })
      : selected === undefined ? Object.freeze({ kind: "none" })
      : Object.freeze({ kind: "value", carrier: selected.carrier, borrowedParameter: returned?.borrowedParameter });
    const error: RustEmissionErrorContext = region === undefined ? Object.freeze({ kind: "none" })
      : Object.freeze({ kind: "region", owner: declaration, region });
    const requirements = input.declarationGenericRequirements.contractFor(declaration,
      role === "body" || role === "native-body" ? true : undefined);
    const required = requirements === undefined ? [] : [
      ...requirements.associatedTypes.flatMap(value => [value.carrier, ...value.output === undefined ? [] : [value.output]]),
      ...requirements.projectProjections.flatMap(value => [value.sourceCarrier, value.targetCarrier]),
      ...requirements.optionalStorage.map(value => value.carrier),
    ];
    requests.push({ use: targetUseSiteRef(subject, role, identity), declaration, bindings, demands, source,
      returnDestination, error, sourceCarriers: [...sourceCarriers, ...required,
        ...generator === undefined ? [] : [generator.yieldType, generator.returnType, generator.nextType, generator.resultCarrier]], physicalCarriers });
  };
  for (const producer of input.nativeProducers.producers) {
    const implementation = input.generic.implementationFor(producer.declaration);
    const bindings = declaredBindings(producer.declaration);
    if (implementation?.creation === "activation") continue;
    request(producer.declaration, "native-body", producer.declaration, producer.identity, bindings,
      byOwner.get(producer.declaration) ?? [], { kind: "declaration" },
      producer.environment.flatMap(argument => argument.kind === "type" ? [argument.type] : []),
      [input.nativeProducers.outwardReturnFor(producer.declaration), input.nativeProducers.invocationResultFor(producer.declaration),
        input.nativeProducers.bodyResultFor(producer.declaration)].filter((carrier): carrier is TargetTypeRef => carrier !== undefined));
  }
  for (const definition of input.generic.definitions) for (const implementation of definition.implementations) {
    const environment = input.generic.physical.environmentFor(implementation);
    if (environment === undefined) {
      diagnostics.push(emissionDiagnostic(implementation.declaration, "An emitted generic callable has no completed canonical physical environment."));
      continue;
    }
    const payloads = [...environment.captures.map(value => value.storageCarrier),
      ...environment.receiverFields.map(value => value.storageCarrier), ...environment.receivers.map(value => value.storageCarrier),
      ...environment.inputs.flatMap(value => [value.implementation, value.trait]),
      ...definition.signature.parameters, definition.signature.result];
    const identity = `${definition.identity}:${implementation.sourceFileName}:${sourceNodeIdentity(input.ast, implementation.declaration)}`;
    const source = { kind: "callable" as const, implementation: implementation.declaration, member: undefined };
    request(implementation, "helper", implementation.declaration, identity, environment.substitutions, [], source, payloads);
    if (implementation.creation === "activation") {
      ownerBindings.set(implementation.declaration, environment.substitutions);
      request(implementation, "body", implementation.declaration, identity, environment.substitutions,
        byOwner.get(implementation.declaration) ?? [], source, payloads);
    }
  }
  for (const definition of input.generic.physical.definitions()) {
    const completion = input.genericCompletions.forDefinition(definition);
    const errors = input.genericErrors.forDefinition(definition);
    if (completion.kind === "unresolved") {
      diagnostics.push(emissionDiagnostic(definition.implementations[0]!.declaration, completion.reason));
      continue;
    }
    for (const member of definition.members) {
      const environment = input.generic.physical.environmentFor(member.implementation);
      const selectedCompletion = completion.kind === "direct" ? completion.result : completion.members.get(member)?.result;
      const selectedErrors = errors?.members.get(member);
      if (environment === undefined || selectedCompletion === undefined || selectedErrors === undefined) {
        diagnostics.push(emissionDiagnostic(member.implementation.declaration,
          "An emitted physical member has no selected environment or completion payload."));
        continue;
      }
      request(member, "member", member.implementation.declaration, definition.identity, member.bindings, [],
        { kind: "callable", implementation: member.implementation.declaration, member },
        [...environment.captures.map(value => value.storageCarrier), ...environment.receiverFields.map(value => value.storageCarrier),
          ...environment.receivers.map(value => value.storageCarrier), ...environment.inputs.flatMap(value => [value.implementation, value.trait]),
          ...definition.signature.parameters],
        [selectedCompletion, selectedErrors?.invocation?.errorType, selectedErrors?.awaiting?.errorType]
          .filter((carrier): carrier is TargetTypeRef => carrier !== undefined), selectedCompletion);
    }
  }
  for (const selected of input.native.inputs) {
    const identity = rustEmissionSourceIdentity(input.ast, selected.owner);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(selected.owner, "A native callable input has no canonical declaration identity."));
      continue;
    }
    request(selected, "native-input", selected.owner, identity, declaredBindings(selected.owner), [],
      { kind: "declaration" },
      [selected.carrier, selected.implementation, selected.trait,
        ...selected.environment.flatMap(argument => argument.kind === "type" ? [argument.type] : []),
        ...selected.protocol.method.parameters, selected.protocol.method.result]);
  }
  for (const implementation of input.suspended.implementations) {
    const identity = rustEmissionSourceIdentity(input.ast, implementation.declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(implementation.declaration, "A suspended native implementation has no canonical declaration identity."));
      continue;
    }
    request(implementation, "native-backing", implementation.declaration, identity,
      declaredBindings(implementation.declaration), [], { kind: "declaration" }, [implementation.carrier, ...implementation.storage]);
  }
  for (const frame of input.frames.definitions) {
    const declaration = frame.activation.ownerDeclaration;
    const identity = rustEmissionSourceIdentity(input.ast, declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "A selected native frame has no canonical source owner identity."));
      continue;
    }
    const bindings = declaredBindings(declaration);
    request(frame, "frame", declaration, identity, bindings, [], { kind: "declaration" }, [...frame.bindings.map(value => value.carrier),
      ...frame.entries.flatMap(entry => [...entry.signature.parameters, entry.signature.result])]);
  }
  for (const plan of input.constructions) {
    if (!input.isNativeNode(plan.definition.declaration) || input.ast.hasModifierKind(plan.definition.declaration, "abstract")) continue;
    for (const issue of plan.emission.issues) diagnostics.push(emissionDiagnostic(issue.node, issue.reason));
    const declaration = plan.definition.declaration;
    const identity = rustEmissionSourceIdentity(input.ast, declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "A selected constructor has no canonical declaration identity."));
      continue;
    }
    request(plan, "constructor", declaration, identity, declaredBindings(declaration),
      [], { kind: "construction", plan, layer: undefined }, plan.fields.map(field => field.carrier));
    const root = input.projectTypes.openCarrier(plan.definition);
    for (const layer of plan.layers) {
      const source = layer.constructor ?? layer.definition.declaration;
      const selected = input.projectTypes.relationship(root, layer.definition);
      const carrier = selected.kind === "related" ? rustSourceTypeCarrierValue(selected.targetType) : undefined;
      const parameters: RustTargetGenericArgument[] = layer.definition.genericParameters.map(parameter => parameter.kind === "lifetime"
        ? { kind: "lifetime", lifetime: parameter.lifetime }
        : { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } });
      const inherited = carrier === undefined ? undefined : rustGenericCallablePhysicalBindings(parameters, carrier.genericArguments);
      const lexical = declaredBindings(source);
      const bindings = inherited === undefined || lexical === undefined ? undefined : snapshotRustCallableBindings({
        types: new Map([...lexical.types, ...inherited.types]), lifetimes: new Map([...lexical.lifetimes, ...inherited.lifetimes]),
        consts: new Map([...lexical.consts, ...inherited.consts]) });
      const points = plan.points.filter(point => plan.emission.preparationFor(point.node)?.layer === layer);
      const demands = [...byOwner.get(layer.definition.declaration) ?? [],
        ...layer.constructor === undefined ? [] : byOwner.get(layer.constructor) ?? []];
      request(layer, "constructor-layer", source, identity, bindings, demands,
        { kind: "construction", plan, layer },
        layer.fields.map(field => field.carrier), points.flatMap(point =>
          plan.emission.preparationFor(point.node)?.projections.flatMap(projection => projection.kind === "receiver" ? [projection.carrier] : []) ?? []));
    }
  }
  return diagnostics.length === 0 ? prepareRustEmissionContextRequests(input, requests) : rejectedTargetStage(diagnostics);
}

export function prepareRustEmissionContextRequests(
  input: Pick<RustCallableEmissionPreparationInput, "ast" | "records" | "nativeStorage" | "sourceOccurrences" | "errorRegions" |
    "sourceStorage" | "genericBindingsFor" | "generic" | "nativeProducers" | "emissionRequests" | "initialization">,
  requests: readonly RustEmissionContextRequest[],
): TargetStageResult<RustCallableEmissionPreparation> {
  const contexts: RustPhysicalEmissionContext[] = [];
  const operands: RustPhysicalEmissionOperand[] = [];
  const contextIndex = new Map<TargetUseSiteRef, RustPhysicalEmissionContext>();
  const sourceOrigins = new Map<TargetUseSiteRef, ReadonlyMap<RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceOrigins>>();
  const operandIndex = new Map<TargetUseSiteRef, RustPhysicalEmissionOperand>();
  const applications = new Map<TargetUseSiteRef, ReadonlyMap<TargetTypeRef, TargetTypeRef>>();
  const physicalOperands = new Set<TargetTypeRef>();
  const diagnostics: TargetDiagnostic[] = [];
  const sourceIndex = new Map<Node, Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>>();
  for (const occurrence of input.sourceOccurrences) {
    const selected = sourceIndex.get(occurrence.node) ?? new Map<RustEmissionProviderOperation, RustPhysicalEmissionSourceOccurrence>();
    selected.set(occurrence.operation, occurrence);
    sourceIndex.set(occurrence.node, selected);
  }
  for (const request of requests) {
    if (!Array.isArray(request.demands)) failTargetAnalysisInvariant("tsonic-rust", "An emitted context requires its original selected demand rows, not a native-node inventory.");
    if (request.source === undefined) failTargetAnalysisInvariant("tsonic-rust", "An emitted context requires its original selected source owner.");
  }
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
    const context: RustPhysicalEmissionContext = { use: request.use, declaration: request.declaration,
      bindings: request.bindings, returnDestination, error: request.error, operands: contextCarriers, sourceOrigins: contextOrigins };
    const add = (node: Node, origin: RustPhysicalEmissionOperandOrigin, source: TargetTypeRef,
      destination: TargetTypeRef | undefined, endpoints: readonly TargetTypeRef[], inputOrdinal?: number): void => {
      const role = origin.kind === "call-input" ? `call-input:${providerSourceInputKey(origin.input)}:${inputOrdinal}`
        : origin.evaluation.kind === "ordinary" ? `${origin.kind}:${targetUseSiteIdentity(origin.evaluation.site)}` : origin.kind;
      const subject = origin.kind === "call-input" ? origin.input
        : origin.evaluation.kind === "provider-source" ? origin.evaluation.slot : origin.evaluation.site.subject;
      const use = targetUseSiteRef(subject, role,
        request.use.enclosingContract, request.use.role);
      const values = new Map<TargetTypeRef, TargetTypeRef>();
      for (const endpoint of [source, ...endpoints, ...destination === undefined ? [] : [destination]]) {
        const carrier = apply(endpoint);
        values.set(endpoint, carrier);
        values.set(carrier, carrier);
      }
      const operand = Object.freeze({ use, node, context, origin, carrier: apply(source),
        destination: destination === undefined ? undefined : apply(destination) });
      operands.push(operand);
      operandIndex.set(use, operand);
      applications.set(use, values);
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
    for (const occurrence of occurrences) for (const carrier of rustPhysicalEmissionOperationCarriers(occurrence.operation.abi)) apply(carrier);
    for (const node of nodes) {
      for (const edge of input.records.sourceErrorEffects.get(node)?.edges ?? []) {
        const selected = input.errorRegions.sourceFor(edge);
        if (selected === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted source call has no selected native error correspondence."));
        else for (const carrier of [...selected.operand.sources.map(source => source.errorType),
          ...selected.operand.jsRejection?.requiredCarriers ?? []]) apply(carrier);
      }
    }
    for (const demand of request.demands) {
      if (demand.kind === "type") {
        apply(demand.carrier);
        continue;
      }
      if (demand.kind === "producer") {
        const physical = input.nativeProducers.physicalFor(demand.declaration, demand.carrier);
        if (physical === undefined) diagnostics.push(emissionDiagnostic(demand.subject,
          "An emitted native callable producer requires its exact selected physical carrier."));
        else apply(physical);
        continue;
      }
      const node = demand.subject;
      const selected = demand.kind === "value" ? input.nativeStorage.valueFor(node)
        : demand.kind === "operand" ? input.nativeStorage.operandFor(node)
        : demand.kind === "return" ? input.nativeStorage.returnFor(node)
        : input.nativeStorage.invocationCallableFor(node);
      if (selected.kind === "unresolved") {
        diagnostics.push(selected.diagnostic ?? emissionDiagnostic(node, selected.reason));
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
      add(node, Object.freeze({ kind: demand.kind, evaluation }), selected.carrier, destination, endpoints);
    }
    const providerSourceCarrier = (occurrence: RustPhysicalEmissionSourceOccurrence,
      slot: RustPhysicalEmissionSourceSlot, role: "value" | "operand"): TargetTypeRef | undefined => {
      if (slot.source.kind === "receiver" && occurrence.receiverProjection.kind === "union-payload")
        return occurrence.receiverProjection.variant.carrier;
      const selected = role === "value" ? input.nativeStorage.valueFor(slot.node) : input.nativeStorage.operandFor(slot.node);
      if (selected.kind === "unresolved") {
        diagnostics.push(selected.diagnostic ?? emissionDiagnostic(slot.node, selected.reason));
        return undefined;
      }
      return selected.carrier;
    };
    for (const occurrence of occurrences) for (const slot of occurrence.slots) {
      const value = providerSourceCarrier(occurrence, slot, "value");
      const operand = providerSourceCarrier(occurrence, slot, "operand");
      if (value === undefined || operand === undefined) continue;
      const evaluation = Object.freeze({ kind: "provider-source" as const, slot });
      const endpoints = [slot.source.row.carrier, ...rustPhysicalEmissionRecordCarriers(input.records, slot.node)];
      const destination = input.records.contextualValueConversion.get(slot.node)?.targetCarrier;
      add(slot.node, Object.freeze({ kind: "value", evaluation }), value, destination, endpoints);
      add(slot.node, Object.freeze({ kind: "operand", evaluation }), operand, destination, endpoints);
    }
    for (const occurrence of occurrences) for (const [ordinal, { input: value, slot }] of occurrence.inputs.entries()) {
      const source = providerSourceCarrier(occurrence, slot, "operand");
      if (source === undefined) continue;
      add(slot.node, Object.freeze({ kind: "call-input", operationNode: occurrence.node, operation: occurrence.operation, input: value }),
        source, value.parameterCarrier, [value.sourceCarrier, value.conversion.sourceCarrier, value.conversion.targetCarrier,
          ...(value.conversion.kind === "sequence" ? value.conversion.steps.flatMap(step => [step.sourceCarrier, step.targetCarrier]) : []),
          ...rustPhysicalEmissionRecordCarriers(input.records, slot.node)], ordinal);
    }
    if (request.error.kind === "region") {
      for (const source of request.error.region.sources) apply(source.errorType);
      for (const carrier of request.error.region.jsRejection?.requiredCarriers ?? []) apply(carrier);
    }
    contextCarriers.push(...carriers);
    Object.freeze(contextCarriers);
    Object.freeze(contextOrigins);
    Object.freeze(context);
    contexts.push(context);
    contextIndex.set(request.use, context);
    applications.set(request.use, applied);
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  return resolvedTargetStage(Object.freeze({ physicalOperands: Object.freeze([...physicalOperands]),
    contexts: sealRustCallableEmissionContexts({ contexts, operands, sourceOccurrences: input.sourceOccurrences,
      contextIndex, operandIndex, applications, sourceOrigins, sourceIndex }) }));
}

export function emissionDiagnostic(node: Node, message: string): TargetDiagnostic {
  return { code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust",
    sourceNode: node, message, evidence: ["rust.callable-value.physical-emission-context"] };
}

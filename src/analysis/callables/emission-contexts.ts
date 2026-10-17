import type { AstReader, Node } from "@tsonic/tsts";
import { targetUseSiteRef, type TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustFinalizedOperationAbi, RustFinalizedValueConversion } from "../../target-model/records/finalized-operation.js";
import type { RustErrorRegionRecords } from "../../target-model/records/error-regions.js";
import type { RustCallableEmissionContexts, RustEmissionErrorContext, RustEmissionReturnDestination,
  RustEmissionProviderOperation, RustPhysicalEmissionContext, RustPhysicalEmissionOperand, RustPhysicalEmissionOperandOrigin,
  RustPhysicalEmissionSourceOccurrence } from "../../target-model/records/physical-emission-contexts.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustProjectConstructionPlan } from "../project-types/construction-plan.js";
import { providerSourceInputKey } from "../operations/provider-source-inputs.js";
import { rustGenericCallablePhysicalBindings, snapshotRustCallableBindings } from "./generic-bindings.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustFrameCallablePlan } from "./frame-values.js";
import type { RustSuspendedCallablePlan } from "./suspended-values.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustPhysicalCallableStorage } from "./physical-lifecycle.js";
import type { RustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustGenericCallableCompletionPlan } from "./generic-completions.js";
import type { RustGenericCallableErrorIndex } from "./generic-errors.js";

export interface RustCallableEmissionPreparationInput {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly records: RustProgramRecords;
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
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  readonly constructions: readonly RustProjectConstructionPlan[];
  readonly projectTypes: Pick<RustProjectTypePolicy, "openCarrier" | "relationship">;
}

export interface RustCallableEmissionPreparation {
  readonly contexts: RustCallableEmissionContexts;
  readonly physicalOperands: readonly TargetTypeRef[];
}

export interface RustEmissionContextRequest {
  readonly use: TargetUseSiteRef;
  readonly declaration: Node;
  readonly bindings: RustTargetGenericBindings;
  readonly returnDestination: RustEmissionReturnDestination;
  readonly error: RustEmissionErrorContext;
  readonly nodes: readonly Node[];
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

export function prepareRustCallableEmissionContexts(
  input: RustCallableEmissionPreparationInput,
): TargetStageResult<RustCallableEmissionPreparation> {
  const requests: RustEmissionContextRequest[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  const byOwner = new Map<Node, Node[]>();
  for (const node of input.nativeNodes) {
    const owner = sourceEnclosingCallable(node, input.ast);
    if (owner === undefined) continue;
    const nodes = byOwner.get(owner) ?? [];
    nodes.push(node);
    byOwner.set(owner, nodes);
  }
  const ownerBindings = new Map<Node, RustTargetGenericBindings>();
  const declaredBindings = (declaration: Node): RustTargetGenericBindings | undefined => {
    const existing = ownerBindings.get(declaration);
    if (existing !== undefined) return existing;
    const contract = input.sourceLifetimes.contractFor(declaration);
    if (contract === undefined && input.ast.typeParameters(declaration).length !== 0) return undefined;
    const arguments_: RustTargetGenericArgument[] = (contract?.parameters ?? []).map(parameter => parameter.kind === "lifetime"
      ? { kind: "lifetime", lifetime: parameter.lifetime }
      : { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } });
    const bindings = rustEmissionIdentityBindings(arguments_);
    if (bindings !== undefined) ownerBindings.set(declaration, bindings);
    return bindings;
  };
  const request = (subject: object, role: string, declaration: Node, identity: string,
    bindings: RustTargetGenericBindings | undefined, nodes: readonly Node[], sourceCarriers: readonly TargetTypeRef[],
    physicalCarriers: readonly TargetTypeRef[] = [], physicalReturn: TargetTypeRef | undefined = undefined): void => {
    if (bindings === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "An emitted native context has no exact canonical type, lifetime and const bindings."));
      return;
    }
    const returned = input.records.sourceCallableReturn.get(declaration);
    const selected = returned === undefined ? undefined : input.nativeStorage.returnFor(declaration);
    if (selected?.kind === "unresolved") {
      diagnostics.push(emissionDiagnostic(declaration, selected.reason));
      return;
    }
    const region = input.errorRegions.get(declaration);
    if (region === undefined && input.records.errorEffects.get(declaration) !== undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "An emitted callable has no selected native error region."));
      return;
    }
    const returnDestination: RustEmissionReturnDestination = physicalReturn !== undefined
      ? Object.freeze({ kind: "value", carrier: physicalReturn, borrowedParameter: returned?.borrowedParameter })
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
    requests.push({ use: targetUseSiteRef(subject, role, identity), declaration, bindings, nodes,
      returnDestination, error, sourceCarriers: [...sourceCarriers, ...required], physicalCarriers });
  };
  for (const producer of input.nativeProducers.producers) {
    const implementation = input.generic.implementationFor(producer.declaration);
    const bindings = rustEmissionIdentityBindings(producer.environment);
    if (bindings !== undefined) ownerBindings.set(producer.declaration, bindings);
    if (implementation?.creation === "activation") continue;
    request(producer.declaration, "native-body", producer.declaration, producer.identity, bindings,
      byOwner.get(producer.declaration) ?? [], producer.environment.flatMap(argument => argument.kind === "type" ? [argument.type] : []),
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
    request(implementation, "helper", implementation.declaration, identity, environment.substitutions, [], payloads);
    if (implementation.creation === "activation") {
      ownerBindings.set(implementation.declaration, environment.substitutions);
      request(implementation, "body", implementation.declaration, identity, environment.substitutions,
        byOwner.get(implementation.declaration) ?? [], payloads);
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
      const selectedCompletion = completion.kind === "direct" ? completion.result : completion.forMember(member)?.result;
      const selectedErrors = errors?.forMember(member);
      if (environment === undefined || selectedCompletion === undefined || selectedErrors === undefined) {
        diagnostics.push(emissionDiagnostic(member.implementation.declaration,
          "An emitted physical member has no selected environment or completion payload."));
        continue;
      }
      request(member, "member", member.implementation.declaration, definition.identity, member.bindings, [],
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
      [selected.carrier, selected.implementation, selected.trait, ...selected.environment,
        ...selected.protocol.method.parameters, selected.protocol.method.result]);
  }
  for (const implementation of input.suspended.implementations) {
    const identity = rustEmissionSourceIdentity(input.ast, implementation.declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(implementation.declaration, "A suspended native implementation has no canonical declaration identity."));
      continue;
    }
    request(implementation, "native-backing", implementation.declaration, identity,
      declaredBindings(implementation.declaration), [], [implementation.carrier, ...implementation.storage]);
  }
  for (const frame of input.frames.definitions) {
    const declaration = frame.activation.ownerDeclaration;
    const identity = rustEmissionSourceIdentity(input.ast, declaration);
    if (identity === undefined) {
      diagnostics.push(emissionDiagnostic(declaration, "A selected native frame has no canonical source owner identity."));
      continue;
    }
    const bindings = declaredBindings(declaration);
    request(frame, "frame", declaration, identity, bindings, [], [...frame.bindings.map(value => value.carrier),
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
      [], plan.fields.map(field => field.carrier));
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
      request(layer, "constructor-layer", source, identity, bindings, points.map(point => point.node),
        layer.fields.map(field => field.carrier), points.flatMap(point =>
          plan.emission.preparationFor(point.node)?.projections.flatMap(projection => projection.kind === "receiver" ? [projection.carrier] : []) ?? []));
    }
  }
  return diagnostics.length === 0 ? prepareRustEmissionContextRequests(input, requests) : rejectedTargetStage(diagnostics);
}

export function prepareRustEmissionContextRequests(
  input: Pick<RustCallableEmissionPreparationInput, "ast" | "records" | "nativeStorage" | "sourceOccurrences" | "errorRegions">,
  requests: readonly RustEmissionContextRequest[],
): TargetStageResult<RustCallableEmissionPreparation> {
  const contexts: RustPhysicalEmissionContext[] = [];
  const operands: RustPhysicalEmissionOperand[] = [];
  const contextIndex = new Map<TargetUseSiteRef, RustPhysicalEmissionContext>();
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
    const carriers = new Set<TargetTypeRef>();
    const applied = new Map<TargetTypeRef, TargetTypeRef>();
    const apply = (source: TargetTypeRef): TargetTypeRef => {
      const existing = applied.get(source);
      if (existing !== undefined) return existing;
      const selected = substituteRustTargetGenerics(source, request.bindings.types, request.bindings.lifetimes, request.bindings.consts);
      const result = selected === source ? source : snapshotClosedMetadata(selected);
      applied.set(source, result);
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
    const context: RustPhysicalEmissionContext = { use: request.use, declaration: request.declaration,
      bindings: request.bindings, returnDestination, error: request.error, operands: contextCarriers };
    const add = (node: Node, origin: RustPhysicalEmissionOperandOrigin, source: TargetTypeRef,
      destination: TargetTypeRef | undefined, endpoints: readonly TargetTypeRef[], inputOrdinal?: number): void => {
      const role = origin.kind === "call-input" ? `call-input:${providerSourceInputKey(origin.input)}:${inputOrdinal}` : origin.kind;
      const subject = origin.kind === "call-input" ? origin.input
        : origin.evaluation.kind === "provider-source" ? origin.evaluation.slot : node;
      const use = targetUseSiteRef(subject, role,
        request.use.enclosingContract, request.use.role);
      const values = new Map<TargetTypeRef, TargetTypeRef>();
      for (const endpoint of [source, ...endpoints, ...destination === undefined ? [] : [destination]]) values.set(endpoint, apply(endpoint));
      const operand = Object.freeze({ use, node, context, origin, carrier: apply(source),
        destination: destination === undefined ? undefined : apply(destination) });
      operands.push(operand);
      operandIndex.set(use, operand);
      applications.set(use, values);
    };
    const occurrences = request.nodes.flatMap(node => [...sourceIndex.get(node)?.values() ?? []]);
    for (const occurrence of occurrences) for (const carrier of rustPhysicalEmissionOperationCarriers(occurrence.operation.abi)) apply(carrier);
    for (const node of request.nodes) {
      for (const edge of input.records.sourceErrorEffects.get(node)?.edges ?? []) {
        const selected = input.errorRegions.sourceFor(edge);
        if (selected === undefined) diagnostics.push(emissionDiagnostic(node, "An emitted source call has no selected native error correspondence."));
        else for (const carrier of [...selected.operand.sources.map(source => source.errorType),
          ...selected.operand.jsRejection?.requiredCarriers ?? []]) apply(carrier);
      }
      if (input.records.compileTimeSource.get(node) === true) continue;
      const endpoints = rustPhysicalEmissionRecordCarriers(input.records, node);
      if (endpoints.length !== 0) {
        const value = input.nativeStorage.valueFor(node);
        const operand = input.nativeStorage.operandFor(node);
        if (value.kind === "unresolved" || operand.kind === "unresolved") {
          diagnostics.push(emissionDiagnostic(node, value.kind === "unresolved" ? value.reason
            : operand.kind === "unresolved" ? operand.reason : "Missing prepared physical storage."));
        } else {
          const destination = input.records.contextualValueConversion.get(node)?.targetCarrier;
          const evaluation = Object.freeze({ kind: "ordinary" as const });
          add(node, Object.freeze({ kind: "value", evaluation }), value.carrier, destination, endpoints);
          add(node, Object.freeze({ kind: "operand", evaluation }), operand.carrier, destination, endpoints);
        }
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
      add(slot.node, Object.freeze({ kind: "value", evaluation }), value.carrier, destination, endpoints);
      add(slot.node, Object.freeze({ kind: "operand", evaluation }), operand.carrier, destination, endpoints);
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
          ...rustPhysicalEmissionRecordCarriers(input.records, slot.node)], ordinal);
    }
    if (request.error.kind === "region") {
      for (const source of request.error.region.sources) apply(source.errorType);
      for (const carrier of request.error.region.jsRejection?.requiredCarriers ?? []) apply(carrier);
    }
    contextCarriers.push(...carriers);
    Object.freeze(contextCarriers);
    Object.freeze(context);
    contexts.push(context);
    contextIndex.set(request.use, context);
    applications.set(request.use, applied);
  }
  if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
  return resolvedTargetStage(Object.freeze({ physicalOperands: Object.freeze([...physicalOperands]),
    contexts: Object.freeze({ contexts: Object.freeze(contexts), operands: Object.freeze(operands), sourceOccurrences: input.sourceOccurrences,
      contextFor: (use: TargetUseSiteRef) => contextIndex.get(use),
      operandFor: (use: TargetUseSiteRef) => operandIndex.get(use),
      carrierFor: (use: TargetUseSiteRef, source: TargetTypeRef) => applications.get(use)?.get(source),
      sourceFor: (node: Node, operation: RustEmissionProviderOperation) => sourceIndex.get(node)?.get(operation) }) }));
}

function emissionDiagnostic(node: Node, message: string): TargetDiagnostic {
  return { code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust",
    sourceNode: node, message, evidence: ["rust.callable-value.physical-emission-context"] };
}

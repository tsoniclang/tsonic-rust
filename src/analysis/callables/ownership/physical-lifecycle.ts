import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries, TargetUseSiteRef } from "@tsonic/target-api/analysis";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { ConditionalExpression_WhenFalse, ConditionalExpression_WhenTrue, Node_Expression, Node_Initializer, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustPhysicalEmissionSourceOccurrence, RustPhysicalEmissionSourceSlot } from "../../../target-model/records/physical-emission-contexts.js";
import type { RustPhysicalCallableFlowApplication } from "../../../target-model/records/physical-callables.js";
import type { RustGenericCallableFlowProducer } from "../../program/records/generic-callable-flow.js";
import { type RustGenericCallableConversion } from "../../../target-model/conversions/generic-callable.js";
import { rustGenericCallableConversionMatches } from "../../../policy/conversions/generic-callable.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustPhysicalPayloadFor } from "../../../policy/conversions/physical-payloads.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion } from "../../conversions/value-carrier-queries.js";
import { type RustStructuralStorageLookup } from "../../../policy/model/operation-record-inputs.js";
import { rustSourceCallCallableStorageCarrier } from "../../../policy/operations/members/native-contracts.js";
import type { RustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import type { RustGenericCallablePhysicalConstruction } from "../generics/generic-physical.js";
import type { RustLexicalFunctionEnvironments } from "../../../target-model/records/lexical-functions.js";
import type { RustNativeStorageConstruction } from "../storage/native-storage.js";
import type { RustNativeStorageSelection } from "../../../target-model/records/native-storage.js";
import type { RustNativeCallableProducerConstruction } from "../native/native-producers.js";
import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native-producers.js";
import { rustEmissionSourceIdentity } from "../emission/emission-contexts.js";

import type { RustPhysicalCallableStorage } from "../../../target-model/records/native-storage.js";
import { sealRustPhysicalCallableStorage } from "../../program/records/physical-callable-storage.js";

export interface RustPhysicalCallablePublication {
  readonly nativeStorage: RustPhysicalCallableStorage;
  readonly nativeProducers: RustNativeCallableProducerPlan;
}

export interface RustPhysicalCallableLifecycle {
  readonly prepared: Pick<RustPhysicalCallableStorage, "valueFor" | "operandFor" | "returnFor" | "invocationCallableFor">;
  complete(physical: RustGenericCallablePhysicalConstruction): TargetStageResult<RustPhysicalCallablePublication>;
}

interface RustPhysicalCallableEmissionUse {
  readonly subject: Node;
  readonly owner: Node;
  readonly context: TargetUseSiteRef;
  readonly bindings: RustTargetGenericBindings;
}

export type RustPhysicalCallableEmissionRequest = RustPhysicalCallableEmissionUse & (
  | { readonly kind: "value" | "operand" | "return" | "invocation" }
  | { readonly kind: "type"; readonly carrier: TargetTypeRef }
  | { readonly kind: "producer"; readonly declaration: Node; readonly carrier: TargetTypeRef }
);

interface RustPhysicalCallableLifecycleInput {
  readonly flowApplications: RustGenericCallableFlowProducer;
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly sourceStorage: SourceStorageQueries;
  readonly requests: readonly RustPhysicalCallableEmissionRequest[];
  readonly sourceOccurrences: readonly RustPhysicalEmissionSourceOccurrence[];
  readonly typeDefinitions: RustTypeDefinitions;
  readonly lexicalFunctions: RustLexicalFunctionEnvironments;
  readonly structuralShapes: RustStructuralStorageLookup;
  readonly adapterFlows: readonly { readonly subject: Node; readonly conversion: RustGenericCallableConversion }[];
  readonly nativeStorage: RustNativeStorageConstruction;
  readonly nativeProducers: RustNativeCallableProducerConstruction;
}

const unavailable: RustPhysicalCallableFlowApplication = Object.freeze({ kind: "unavailable" });
const identity: RustPhysicalCallableFlowApplication = Object.freeze({ kind: "identity" });
const missingDestination: RustPhysicalCallableFlowApplication = Object.freeze({ kind: "missing-destination" });
const unpreparedStorage: RustNativeStorageSelection = Object.freeze({ kind: "unresolved",
  reason: "Native callable storage was not prepared for this owned source query before publication." });

export function createRustPhysicalCallableLifecycle(input: RustPhysicalCallableLifecycleInput): RustPhysicalCallableLifecycle {
  if (!Array.isArray(input.requests)) failTargetAnalysisInvariant("tsonic-rust", "Physical callable storage requires its complete selecting-owner request vector.");
  if (!Array.isArray(input.sourceOccurrences)) failTargetAnalysisInvariant("tsonic-rust", "Physical callable storage requires its original selected source occurrence vector.");
  const { ast, records, nativeStorage: queries } = input;
  const diagnostics: TargetDiagnostic[] = [];
  const sourceNodes = new Map<object, Node>(input.sourceStorage.nodes.map(node => [node, node]));
  const sourceSlots = new Map<object, RustPhysicalEmissionSourceSlot>();
  const ownerContexts = new Map<Node, { readonly identity: string | undefined; readonly bindings: RustTargetGenericBindings }>();
  const parents = new Map<Node, Node | undefined>();
  const contains = (ancestor: Node, subject: Node): boolean => {
    const visited = new Set<Node>();
    for (let current: Node | undefined = subject; current !== undefined && !visited.has(current);) {
      if (current === ancestor) return true;
      visited.add(current);
      if (!parents.has(current)) parents.set(current, ast.parent(current));
      current = parents.get(current);
    }
    return false;
  };
  const reject = (subject: Node, message: string): void => {
    diagnostics.push({ code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust",
      sourceNode: subject, message, evidence: ["rust.callable-value.physical-emission-context"] });
  };
  for (const occurrence of input.sourceOccurrences) for (const slot of occurrence.slots) {
    if (!sourceNodes.has(occurrence.node) || !sourceNodes.has(slot.node) || sourceSlots.has(slot) ||
      slot.operationNode !== occurrence.node || slot.operation !== occurrence.operation) {
      reject(occurrence.node, "A required physical source slot has no exact original checked occurrence and operation correspondence.");
      continue;
    }
    sourceSlots.set(slot, slot);
  }
  for (const request of input.requests) {
    if (!sourceNodes.has(request.subject) || !sourceNodes.has(request.owner) ||
      request.kind === "producer" && !sourceNodes.has(request.declaration)) {
      reject(request.owner, "A required physical callable use has no exact checked source subject, owner or producer.");
      continue;
    }
    if (request.context === undefined || request.bindings === undefined ||
      request.context.subject === undefined ||
      typeof request.context.role !== "string" || request.context.role.length === 0 ||
      typeof request.context.enclosingContract !== "string" || request.context.enclosingContract.length === 0 ||
      request.bindings.types === undefined || request.bindings.lifetimes === undefined || request.bindings.consts === undefined ||
      (request.kind === "type" || request.kind === "producer") && request.carrier === undefined) {
      reject(request.subject, "A required physical callable use has no complete original use-site, binding or carrier input.");
      continue;
    }
    const sourceSlot = sourceSlots.get(request.context.subject);
    const sourceNode = sourceNodes.get(request.context.subject);
    if (sourceSlot !== undefined ? sourceSlot.node !== request.subject || sourceSlot.key !== request.context.role ||
        request.kind !== "value" && request.kind !== "operand"
      : sourceNode === undefined || !contains(sourceNode, request.subject)) {
      reject(request.subject, "A required physical callable use has no exact original source node or selected source-slot correlation.");
      continue;
    }
    let context = ownerContexts.get(request.owner);
    if (context === undefined) {
      context = { identity: rustEmissionSourceIdentity(ast, request.owner), bindings: request.bindings };
      ownerContexts.set(request.owner, context);
    }
    if (context.identity === undefined || context.identity !== request.context.enclosingContract ||
      context.bindings !== request.bindings)
      reject(request.subject, "A required physical callable use has no exact selecting-owner contract and original binding identity.");
  }
  const values = new Map<Node, RustNativeStorageSelection>();
  const operands = new Map<Node, RustNativeStorageSelection>();
  const invocations = new Map<Node, RustNativeStorageSelection>();
  const requestedReturns = new Set(input.requests.filter(request => request.kind === "return").map(request => request.subject));
  const prepared = Object.freeze({
    valueFor: (node: Node) => values.get(node) ?? unpreparedStorage,
    operandFor: (node: Node) => operands.get(node) ?? unpreparedStorage,
    returnFor: (node: Node) => requestedReturns.has(node) ? queries.returnFor(node) : unpreparedStorage,
    invocationCallableFor: (node: Node) => invocations.get(node) ?? unpreparedStorage,
  });
  const producerRequests = Object.freeze(input.requests.filter((request): request is
    Extract<RustPhysicalCallableEmissionRequest, { readonly kind: "producer" }> => request.kind === "producer"));
  const flows: { readonly node: Node; readonly conversion: RustGenericCallableConversion }[] = [];
  const destinations = new Map<Node, TargetTypeRef | undefined>();
  let storageReady = false;
  const genericCarriers = new Map<TargetTypeRef, boolean>();
  const requiresFamilyAdmission = (carrier: TargetTypeRef | undefined): boolean => {
    if (carrier === undefined) return false;
    const existing = genericCarriers.get(carrier);
    if (existing !== undefined) return existing;
    genericCarriers.set(carrier, false);
    const selected = rustGenericCallableValue(carrier) !== undefined || rustTargetTypeChildren(carrier).some(requiresFamilyAdmission);
    genericCarriers.set(carrier, selected);
    return selected;
  };
  const value = (node: Node): RustNativeStorageSelection => {
    if (!storageReady && !requiresFamilyAdmission(rustEffectiveValueCarrier(records, node))) return unpreparedStorage;
    const existing = values.get(node);
    if (existing !== undefined) return existing;
    const selection = queries.valueFor(node);
    values.set(node, selection);
    return selection;
  };
  const operand = (node: Node): RustNativeStorageSelection => {
    if (!storageReady && !requiresFamilyAdmission(rustValueCarrierBeforeContextualConversion(records, node))) return unpreparedStorage;
    const existing = operands.get(node);
    if (existing !== undefined) return existing;
    const selection = queries.operandFor(node);
    operands.set(node, selection);
    return selection;
  };
  const returned = (node: Node): RustNativeStorageSelection => {
    if (!storageReady && !requiresFamilyAdmission(records.sourceCallableReturn.get(node)?.returnCarrier)) return unpreparedStorage;
    return queries.prepareReturn(node);
  };
  const requestStorage = (request: RustPhysicalCallableEmissionRequest): RustNativeStorageSelection | undefined => {
    switch (request.kind) {
      case "value": return value(request.subject);
      case "operand": return operand(request.subject);
      case "return": return returned(request.subject);
      case "invocation": {
        const existing = invocations.get(request.subject);
        if (existing !== undefined) return existing;
        const operation = records.targetOperation.get(request.subject);
        const storage = rustSourceCallCallableStorageCarrier(operation, input.structuralShapes);
        if (!storageReady && rustGenericCallableValue(storage) === undefined) return unpreparedStorage;
        const selection = operation?.kind === "source-call" && operation.target.form === "structural-method" &&
          input.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex)?.methodPlan?.kind !== "native-dispatch" &&
          rustCallableProtocol(storage) !== undefined && storage !== undefined
          ? Object.freeze({ kind: "identity" as const, carrier: storage, sources: Object.freeze([]) })
          : queries.invocationCallableFor(request.subject);
        invocations.set(request.subject, selection);
        return selection;
      }
      case "type": return undefined;
      case "producer": return undefined;
    }
  };
  if (diagnostics.length === 0) for (const request of input.requests) {
    requestStorage(request);
    if (request.kind === "value" || request.kind === "operand") {
      const conversion = records.contextualValueConversion.get(request.subject)?.conversion;
      if (conversion?.kind === "generic-callable-flow") flows.push({ node: request.subject, conversion });
    }
  }
  const inheritedDestination = (node: Node): TargetTypeRef | undefined => {
    if (destinations.has(node)) return destinations.get(node);
    const parent = ast.parent(node);
    let destination: TargetTypeRef | undefined;
    if (parent !== undefined) {
      if (ast.is.IsConditionalExpression(parent) &&
        (ConditionalExpression_WhenTrue(ast, parent) === node || ConditionalExpression_WhenFalse(ast, parent) === node)) {
        destination = inheritedDestination(parent);
      } else if (ast.is.IsVariableDeclaration(parent) && Node_Initializer(ast, parent) === node) {
        if (input.lexicalFunctions.forDeclaration(node) === undefined) {
          const selected = values.get(parent);
          if (selected?.kind === "selected") destination = selected.carrier;
        }
      } else {
        const owner = ast.is.IsReturnStatement(parent) && Node_Expression(ast, parent) === node
          ? sourceEnclosingCallable(parent, ast) : ast.is.IsArrowFunction(parent) && ast.body(parent) === node ? parent : undefined;
        if (owner !== undefined) {
          const selected = prepared.returnFor(owner);
          if (selected?.kind === "selected") destination = selected.carrier;
        } else if ((ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) && ast.arguments(parent).includes(node)) {
          destination = queries.invocationArgumentWitnessFor(parent, node);
        }
      }
    }
    destinations.set(node, destination);
    return destination;
  };
  const requestedValues = new Set(input.requests.filter(request => request.kind === "value").map(request => request.subject));
  const requestedOperands = new Set(input.requests.filter(request => request.kind === "operand").map(request => request.subject));
  for (const flow of input.adapterFlows) flows.push({ node: flow.subject, conversion: flow.conversion });
  for (const flow of flows) if (!requestedValues.has(flow.node) || !requestedOperands.has(flow.node))
    reject(flow.node, "A required generic callable flow has no exact selected value and operand use requests.");
  let complete = false;
  return Object.freeze({
    prepared,
    complete(physical: RustGenericCallablePhysicalConstruction): TargetStageResult<RustPhysicalCallablePublication> {
      if (complete) failTargetAnalysisInvariant("tsonic-rust", "Physical callable storage and applications complete exactly once.");
      complete = true;
      if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
      storageReady = true;
      for (const request of input.requests) {
        const selection = requestStorage(request);
        if (selection?.kind === "unresolved") reject(request.subject, selection.reason);
      }
      if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
      for (const flow of flows) inheritedDestination(flow.node);
      for (const node of values.keys()) inheritedDestination(node);
      const finalizedProducers = input.nativeProducers.seal(producerRequests);
      if (finalizedProducers.kind === "rejected") return rejectedTargetStage(finalizedProducers.diagnostics);
      const nativeProducers = finalizedProducers.value;
      for (const request of input.requests) if (request.kind === "type") physical.prepare(request.carrier);
      for (const selections of [values, operands, invocations]) for (const selection of selections.values()) {
        if (selection.kind !== "unresolved") physical.prepare(selection.carrier);
      }
      for (const owner of requestedReturns) {
        const selection = prepared.returnFor(owner);
        if (selection.kind !== "unresolved") physical.prepare(selection.carrier);
      }
      for (const producer of nativeProducers.producers) for (const carrier of [nativeProducers.outwardReturnFor(producer.declaration),
        nativeProducers.invocationResultFor(producer.declaration), nativeProducers.bodyResultFor(producer.declaration)]) {
        if (carrier !== undefined) physical.prepare(carrier);
      }
      for (const request of producerRequests) {
        const carrier = nativeProducers.physicalFor(request.declaration, request.carrier);
        if (carrier === undefined) return failTargetAnalysisInvariant("tsonic-rust",
          "A completed required native producer lost its selected physical result.", request.subject);
        physical.prepare(carrier);
      }
      for (const [node, destination] of destinations) {
        if (destination === undefined) continue;
        const selected = values.get(node);
        const logical = rustEffectiveValueCarrier(records, node);
        if (selected === undefined || selected.kind === "unresolved" || logical === undefined) continue;
        const visited = new Set<TargetTypeRef>();
        const prepare = (carrier: TargetTypeRef): void => {
          if (visited.has(carrier)) return;
          visited.add(carrier);
          if (rustGenericCallableValue(carrier) !== undefined) {
            const source = rustPhysicalPayloadFor(logical, selected.carrier, carrier, input.typeDefinitions);
            const target = rustPhysicalPayloadFor(logical, destination, carrier, input.typeDefinitions);
            if (source !== undefined && target !== undefined) physical.prepareConversion(source, target);
          }
          for (const child of rustTargetTypeChildren(carrier)) prepare(child);
        };
        prepare(logical);
      }
      const selectApplication = (node: Node, conversion: RustGenericCallableConversion,
        demanded: TargetTypeRef | undefined): RustPhysicalCallableFlowApplication => {
        const source = operands.get(node)!;
        const selected = demanded === undefined ? values.get(node)! : { kind: "identity" as const, carrier: demanded };
        if (source.kind === "unresolved" || selected.kind === "unresolved") return unavailable;
        const logical = rustEffectiveValueCarrier(records, node);
        const destination = logical === undefined ? undefined
          : rustPhysicalPayloadFor(logical, selected.carrier, conversion.target, input.typeDefinitions);
        if (destination === undefined) return missingDestination;
        physical.prepare(destination);
        if (rustTargetTypeRefEquals(source.carrier, destination)) return identity;
        const transition = physical.prepareConversion(source.carrier, destination);
        if (transition === undefined) return unavailable;
        if (transition.kind === "identity") return identity;
        return Object.freeze({ kind: "variants", source: source.carrier, destination,
          members: Object.freeze(transition.members.map(member => Object.freeze({
            source: member.source.variantName, target: member.target.variantName }))) });
      };
      for (const flow of flows) {
        if (!rustGenericCallableConversionMatches(flow.conversion, flow.conversion.source, flow.conversion.target)) continue;
        for (const destination of [undefined, destinations.get(flow.node)]) {
          if (input.flowApplications.records.genericCallableFlow.get(flow.node, flow.conversion, destination) === undefined)
            input.flowApplications.publish(flow.node, flow.conversion, destination, selectApplication(flow.node, flow.conversion, destination));
        }
        const application = input.flowApplications.records.genericCallableFlow.get(flow.node, flow.conversion, destinations.get(flow.node));
        if (application?.kind === "missing-destination" || application?.kind === "unavailable") diagnostics.push(Object.freeze({
          code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: flow.node,
          message: `A generic callable conversion requires the exact payload of its finalized physical value destination. Node kind: ${input.ast.kindName(flow.node)}.`,
          evidence: Object.freeze(["target.capability=rust.backend.generic-callable-destination"]),
        }));
      }
      if (diagnostics.length !== 0) return rejectedTargetStage(diagnostics);
      const nativeStorage = sealRustPhysicalCallableStorage({ ...prepared, issues: queries.issues,
        parameterFor: queries.parameterFor,
        futureEnvironmentFor: queries.futureEnvironmentFor,
        invocationWitnessFor: queries.invocationWitnessFor,
        invocationArgumentWitnessFor: queries.invocationArgumentWitnessFor,
        joinWriteFor: queries.joinWriteFor,
      });
      return resolvedTargetStage(Object.freeze({ nativeStorage, nativeProducers }));
    },
  });
}

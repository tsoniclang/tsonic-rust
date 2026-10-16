import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { failTargetPlannerInvariant } from "@tsonic/target-api/artifacts";
import { ConditionalExpression_WhenFalse, ConditionalExpression_WhenTrue, Node_Expression,
  Node_Initializer, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustPhysicalCallableFlowApplication, RustPhysicalCallableFlowApplications }
  from "../../target-model/records/physical-callables.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustGenericCallableConversionMatches, type RustGenericCallableConversion }
  from "../../target-model/conversions/generic-callable.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustPhysicalPayloadFor } from "../../target-model/types/physical-payloads.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion }
  from "../conversions/value-carrier-queries.js";
import { rustSourceCallCallableStorageCarrier, type RustStructuralStorageLookup }
  from "../operations/target-operation.js";
import type { RustFrameCallablePlan } from "./frame-values.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustGenericCallablePhysicalConstruction } from "./generic-physical.js";
import type { RustLexicalFunctionEnvironments } from "./lexical-functions.js";
import type { RustNativeStoragePlan, RustNativeStorageSelection } from "./native-storage.js";
import type { RustNativeCallableProducerConstruction, RustNativeCallableProducerPlan } from "./native-producers.js";
import type { RustSuspendedCallablePlan } from "./suspended-values.js";

export type RustPhysicalCallableStorage = Pick<RustNativeStoragePlan,
  "issues" | "parameterFor" | "futureEnvironmentFor" | "returnFor" | "valueFor" | "operandFor" |
  "invocationCallableFor" | "invocationWitnessFor" | "invocationArgumentWitnessFor">;

export interface RustPhysicalCallablePublication {
  readonly nativeStorage: RustPhysicalCallableStorage;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly flowApplications: RustPhysicalCallableFlowApplications;
}

export interface RustPhysicalCallableLifecycle {
  complete(physical: RustGenericCallablePhysicalConstruction): RustPhysicalCallablePublication;
}

interface RustPhysicalCallableLifecycleInput {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly sourceStorage: SourceStorageQueries;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly generic: RustGenericCallablePlan;
  readonly lexicalFunctions: RustLexicalFunctionEnvironments;
  readonly structuralShapes: RustStructuralStorageLookup;
  readonly frames: RustFrameCallablePlan;
  readonly suspended: RustSuspendedCallablePlan;
  readonly adapterFlows: readonly { readonly subject: Node; readonly conversion: RustGenericCallableConversion }[];
  readonly nativeStorage: RustNativeStoragePlan;
  readonly nativeProducers: RustNativeCallableProducerConstruction;
}

const unavailable: RustPhysicalCallableFlowApplication = Object.freeze({ kind: "unavailable" });
const identity: RustPhysicalCallableFlowApplication = Object.freeze({ kind: "identity" });
const missingDestination: RustPhysicalCallableFlowApplication = Object.freeze({ kind: "missing-destination" });
const unpreparedStorage: RustNativeStorageSelection = Object.freeze({ kind: "unresolved",
  reason: "Native callable storage was not prepared for this owned source query before publication." });

export function createRustPhysicalCallableLifecycle(input: RustPhysicalCallableLifecycleInput): RustPhysicalCallableLifecycle {
  const { ast, records, nativeStorage: queries } = input;
  const values = new Map<Node, RustNativeStorageSelection>();
  const operands = new Map<Node, RustNativeStorageSelection>();
  const returns = new Map<Node, RustNativeStorageSelection>();
  const invocations = new Map<Node, RustNativeStorageSelection>();
  const producerRequests = new Map<Node, TargetTypeRef[]>();
  const flows: { readonly node: Node; readonly conversion: RustGenericCallableConversion }[] = [];
  const destinations = new Map<Node, TargetTypeRef | undefined>();
  const valueRoots = new Set<Node>();
  const operandRoots = new Set<Node>();
  const returnRoots = new Set<Node>();
  const invocationRoots = new Set<Node>();
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
    valueRoots.add(node);
    if (!storageReady && !requiresFamilyAdmission(rustEffectiveValueCarrier(records, node))) return unpreparedStorage;
    const existing = values.get(node);
    if (existing !== undefined) return existing;
    const selection = queries.valueFor(node);
    values.set(node, selection);
    return selection;
  };
  const operand = (node: Node): RustNativeStorageSelection => {
    operandRoots.add(node);
    if (!storageReady && !requiresFamilyAdmission(rustValueCarrierBeforeContextualConversion(records, node))) return unpreparedStorage;
    const existing = operands.get(node);
    if (existing !== undefined) return existing;
    const selection = queries.operandFor(node);
    operands.set(node, selection);
    return selection;
  };
  const returned = (node: Node): RustNativeStorageSelection => {
    returnRoots.add(node);
    if (!storageReady && !requiresFamilyAdmission(records.sourceCallableReturn.get(node)?.returnCarrier)) return unpreparedStorage;
    const existing = returns.get(node);
    if (existing !== undefined) return existing;
    const selection = queries.returnFor(node);
    returns.set(node, selection);
    return selection;
  };
  const requestProducer = (declaration: Node, carrier: TargetTypeRef | undefined): void => {
    if (carrier === undefined || rustCallableProtocol(carrier) === undefined) return;
    const requests = producerRequests.get(declaration) ?? [];
    if (!requests.some(existing => rustTargetTypeRefEquals(existing, carrier))) requests.push(carrier);
    producerRequests.set(declaration, requests);
  };
  for (const node of input.sourceStorage.nodes) {
    if (records.sourceCallableReturn.get(node) !== undefined) {
      returned(node);
    }
    if (records.runtimeCarrier.get(node) !== undefined || records.contextualValueConversion.get(node) !== undefined) {
      value(node);
      operand(node);
    }
    const lexical = input.lexicalFunctions.forDeclaration(node);
    if (lexical?.kind === "resolved") for (const capture of lexical.captures) value(capture.reference);
    if (ast.is.IsVariableDeclaration(node)) value(node);
    const conversion = records.contextualValueConversion.get(node)?.conversion;
    if (conversion?.kind === "callable-adapter") value(node);
    if (conversion?.kind === "generic-callable-flow") flows.push({ node, conversion });
    if (input.generic.implementationFor(node) !== undefined ||
      rustCallableProtocol(rustValueCarrierBeforeContextualConversion(records, node)) !== undefined) operand(node);
    const operation = records.targetOperation.get(node);
    if (operation?.kind === "source-call") {
      invocationRoots.add(node);
      const callee = Node_Expression(ast, node);
      if (callee !== undefined && rustCallableProtocol(rustValueCarrierBeforeContextualConversion(records, callee)) !== undefined)
        operand(callee);
      if (rustGenericCallableValue(rustSourceCallCallableStorageCarrier(operation, input.structuralShapes)) !== undefined)
        invocations.set(node, queries.invocationCallableFor(node));
    }
    if (operation?.kind === "closure") {
      const implementation = input.frames.implementationFor(node);
      const frame = input.frames.entryFor(operation.resultCarrier);
      const protocol = rustCallableProtocol(operation.resultCarrier);
      const independent = implementation?.independent === true && frame?.hasIndependent === true &&
        frame.implementations.includes(implementation) && protocol !== undefined
        ? rustCallableTargetType(protocol.parameters, protocol.result) : undefined;
      requestProducer(node, independent ?? records.receiverIndependentMethod.get(node)?.carrier ?? operation.resultCarrier);
    }
    const direct = records.directCallableReference.get(node);
    if (direct !== undefined) requestProducer(direct.sourceDeclaration, direct.carrier);
    const source = records.sourceCallableValue.get(node);
    if (source !== undefined) requestProducer(source.sourceDeclaration, source.carrier);
    const binding = records.moduleBinding.get(node);
    if (binding?.storage === "native-callable" && binding.value !== undefined)
      requestProducer(binding.callableDeclaration, binding.value.carrier);
    const suspended = input.suspended.implementationFor(node);
    if (suspended !== undefined) requestProducer(node, suspended.carrier);
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
          const selected = value(parent);
          if (selected.kind === "selected") destination = selected.carrier;
        }
      } else {
        const owner = ast.is.IsReturnStatement(parent) && Node_Expression(ast, parent) === node
          ? sourceEnclosingCallable(parent, ast) : ast.is.IsArrowFunction(parent) && ast.body(parent) === node ? parent : undefined;
        if (owner !== undefined) {
          const selected = returned(owner);
          if (selected.kind === "selected") destination = selected.carrier;
        } else if ((ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) && ast.arguments(parent).includes(node)) {
          destination = queries.invocationArgumentWitnessFor(parent, node);
        }
      }
    }
    destinations.set(node, destination);
    return destination;
  };
  for (const flow of input.adapterFlows) flows.push({ node: flow.subject, conversion: flow.conversion });
  for (const flow of flows) {
    operand(flow.node);
    value(flow.node);
  }
  let complete = false;
  return Object.freeze({
    complete(physical: RustGenericCallablePhysicalConstruction): RustPhysicalCallablePublication {
      if (complete) throw new Error("Physical callable storage and applications complete exactly once.");
      storageReady = true;
      for (const node of returnRoots) returned(node);
      for (const node of valueRoots) value(node);
      for (const node of operandRoots) operand(node);
      for (const node of invocationRoots) {
        if (!invocations.has(node)) invocations.set(node, queries.invocationCallableFor(node));
      }
      for (const flow of flows) inheritedDestination(flow.node);
      for (const node of values.keys()) inheritedDestination(node);
      const nativeProducers = input.nativeProducers.seal(producerRequests);
      for (const node of input.sourceStorage.nodes) {
        const parameter = records.sourceParameterAbi.get(node);
        for (const carrier of [records.runtimeCarrier.get(node)?.carrier, records.sourceCallableReturn.get(node)?.returnCarrier,
          parameter?.valueCarrier, parameter?.parameterCarrier]) {
          if (carrier !== undefined) physical.prepare(carrier);
        }
      }
      for (const selections of [values, operands, returns, invocations]) for (const selection of selections.values()) {
        if (selection.kind !== "unresolved") physical.prepare(selection.carrier);
      }
      for (const producer of nativeProducers.producers) for (const carrier of [nativeProducers.outwardReturnFor(producer.declaration),
        nativeProducers.invocationResultFor(producer.declaration), nativeProducers.bodyResultFor(producer.declaration),
        ...(producerRequests.get(producer.declaration) ?? []).map(carrier => nativeProducers.physicalFor(producer.declaration, carrier))]) {
        if (carrier !== undefined) physical.prepare(carrier);
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
      const applications = new Map<Node, Map<string, RustPhysicalCallableFlowApplication>>();
      const applicationKey = (conversion: RustGenericCallableConversion, destination: TargetTypeRef | undefined): string =>
        closedMetadataKey([conversion, destination]);
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
        const selected = applications.get(flow.node) ?? new Map<string, RustPhysicalCallableFlowApplication>();
        applications.set(flow.node, selected);
        for (const destination of [undefined, destinations.get(flow.node)]) {
          const key = applicationKey(flow.conversion, destination);
          if (!selected.has(key)) selected.set(key, selectApplication(flow.node, flow.conversion, destination));
        }
      }
      const flowApplications: RustPhysicalCallableFlowApplications = Object.freeze({
        forNode(node: Node, conversion: RustGenericCallableConversion, destination: TargetTypeRef | undefined) {
          const entries = applications.get(node);
          if (entries === undefined) return failTargetPlannerInvariant("tsonic-rust",
            "A generic callable flow has no prepared source application.", node);
          const selected = entries.get(applicationKey(conversion, destination));
          if (selected === undefined) return failTargetPlannerInvariant("tsonic-rust",
            "A generic callable flow has no prepared physical destination application.", node);
          return selected;
        },
      });
      const nativeStorage: RustPhysicalCallableStorage = Object.freeze({ issues: queries.issues,
        parameterFor: queries.parameterFor,
        futureEnvironmentFor: queries.futureEnvironmentFor,
        valueFor: (node: Node) => values.get(node) ?? unpreparedStorage,
        operandFor: (node: Node) => operands.get(node) ?? unpreparedStorage,
        returnFor: (node: Node) => returns.get(node) ?? unpreparedStorage,
        invocationCallableFor: (node: Node) => invocations.get(node) ?? unpreparedStorage,
        invocationWitnessFor: queries.invocationWitnessFor,
        invocationArgumentWitnessFor: queries.invocationArgumentWitnessFor,
      });
      complete = true;
      return Object.freeze({ nativeStorage, nativeProducers, flowApplications });
    },
  });
}

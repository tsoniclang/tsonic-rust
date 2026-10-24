import { createRustNativeStorageSelection } from "./native-storage-selection.js";
import type { RustNativeCaptureSelection } from "../../target-model/records/native-captures.js";
import type { RustStructuralShapePlanRegistry } from "../objects/shapes/structural-shape-plan.js";
import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageBindingsSelection, SourceStorageQueries, SourceStorageSubject, SourceStorageSubjectsSelection, SourceStorageProducersSelection } from "@tsonic/target-api/analysis";
import { isSourceCallableBodyBoundary, sourceEnclosingCallable, sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

import type { RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";

import { rustSourceOptionalTargetType } from "../../target-model/types/projections.js";

import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";

import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";

import { asSourceNode } from "@tsonic/target-api/source";

import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";

import { selectRustNativeStorageGenericBindings, type RustNativeStorageGenericSelection } from "./native-storage-generics.js";
import { createRustNativeFutureInputPlan } from "./native-future-inputs.js";
import { collectRustNativeAbsenceWitnesses, selectRustNativeConversionBoundaries } from "./native-storage-witnesses.js";
import { createRustRecordMemberProducers } from "./native-storage-members.js";
import { type RustNativeFutureEnvironmentSelection } from "../../target-model/records/native-future-inputs.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeCallableInput } from "../../target-model/records/native-protocols.js";
import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustGenericCallablePhysicalCarrierSelector } from "./generic-physical.js";
import type { RustLexicalFunctionEnvironments } from "../../target-model/records/lexical-functions.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustSourceCallCallableStorageCarrier } from "../../policy/operations/members/native-contracts.js";
import type { RustStructuralStorageLookup } from "../../policy/model/operation-record-inputs.js";
import { rustSourceStorageProjectedCarrier, type RustValueDomainCarrierHost } from "../objects/value-domain-carriers.js";
import { selectRustSourceCallableInvocationBindings } from "./native-storage-generics.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";

import type { RustCallableJoinWrite } from "../../target-model/records/native-storage.js";

export interface RustNativeStoragePlan {
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  logicalCarrierFor(subject: SourceStorageSubject, bindings: SourceStorageBindings): TargetTypeRef | undefined;
  genericBindingsFor(declaration: Node, bindings: SourceStorageBindings): RustNativeStorageGenericSelection;
  futureEnvironmentFor(declaration: Node): RustNativeFutureEnvironmentSelection;
  readonly parameterFor: (parameter: Node) => RustNativeStorageSelection;
  returnFor(declaration: Node): RustNativeStorageSelection;
  valueFor(node: Node): RustNativeStorageSelection;
  operandFor(node: Node): RustNativeStorageSelection;
  invocationCallableFor(node: Node): RustNativeStorageSelection;
  subjectFor(subject: SourceStorageSubject, carrier: TargetTypeRef, owner?: Node): RustNativeStorageSelection;
  boundSubjectFor(subject: SourceStorageSubject, carrier: TargetTypeRef, bindings: SourceStorageBindings): RustNativeStorageSelection;
  invocationReturnFor(implementation: Node, invocation: Node, owner?: Node): RustNativeStorageSelection;
  invocationInputFor(input: RustNativeCallableInput, invocation: Node, owner?: Node): RustNativeStorageSelection;
  invocationWitnessFor(input: RustNativeCallableInput, invocation: Node): TargetTypeRef | undefined;
  invocationArgumentWitnessFor(invocation: Node, argument: Node): TargetTypeRef | undefined;
  joinWriteFor(node: Node): RustCallableJoinWrite | undefined;
  extendRecordMemberProducers(selection: SourceStorageProducersSelection): SourceStorageProducersSelection;
  invocationOriginsFor(input: RustNativeCallableInput, invocation: Node, owner?: Node): SourceStorageSubjectsSelection;
  implementationOriginsFor(input: RustNativeCallableInput): SourceStorageProducersSelection;
}

export interface RustNativeStorageConstruction extends RustNativeStoragePlan {
  prepareReturn(declaration: Node): RustNativeStorageSelection;
}

export type RustNativeStorageQueries = Omit<RustNativeStorageConstruction, "parameterFor">;

export function createRustNativeStorageQueries(input: {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions;
  readonly native: RustNativeCallableInputPlan;
  readonly producers: RustNativeCallableProducerPlan;
  readonly generic: RustGenericCallablePlan;
  readonly physicalCarrierFor: RustGenericCallablePhysicalCarrierSelector;
  readonly lifetimes: RustLifetimeIndex;
  readonly lexicalFunctions: RustLexicalFunctionEnvironments;
  readonly structuralShapes: RustStructuralStorageLookup & Pick<RustStructuralShapePlanRegistry, "completePhysicalCarrier" | "definitionForCarrier">;
  readonly capturesFor: (declaration: Node) => RustNativeCaptureSelection;
  readonly carrierHost: RustValueDomainCarrierHost;
  // Resolved after the error regions; storage shared by distinct producers is selected only once it is available.
  readonly producerErrorFor: (reference: RustProducerErrorReference) => TargetTypeRef | undefined;
  // Source type families (indexed field outputs) resolved to their selected native carriers.
  readonly normalizeTypeFamily: (carrier: TargetTypeRef) => TargetTypeRef;
}): RustNativeStorageQueries {
  const nodes = new Set(input.storage.nodes);
  const inputs = new Map(input.native.inputs.map(value => [value.subject, value]));
  const ownedInputs = new Set(input.native.inputs);
  const joinWrites = new Map<Node, RustCallableJoinWrite>();
  const conversions = selectRustNativeConversionBoundaries(input);
  const unresolved = (reason: string): Extract<RustNativeStorageSelection, { readonly kind: "unresolved" }> =>
    Object.freeze({ kind: "unresolved", reason });
  const returns = new Map<Node, RustNativeStorageSelection>();
  const unpreparedReturn = unresolved("Native callable return requires its prepared physical source selection.");
  const bindingsFor = (owner: Node | undefined): SourceStorageBindings | undefined => owner === undefined
    ? input.storage.emptyBindings : nodes.has(owner) ? input.native.bindingsFor(owner) : undefined;
  const ownerFor = (node: Node): Node | undefined => sourceEnclosingCallable(node, input.ast);
  // A callable expression's value is created in the callable that contains it, not in its own activation.
  const valueOwnerFor = (node: Node): Node | undefined => isSourceCallableBodyBoundary(input.ast, node)
    ? sourceEnclosingCallable(input.ast.parent(node), input.ast) : ownerFor(node);
  const futures = createRustNativeFutureInputPlan({ ...input, bindingsFor });
  const logicalCarriers = new Map<SourceStorageSubject, Map<SourceStorageBindings, TargetTypeRef>>();
  const logicalCarrierFor = (subject: SourceStorageSubject, bindings: SourceStorageBindings): TargetTypeRef | undefined => {
    const previous = logicalCarriers.get(subject);
    const cached = previous?.get(bindings);
    if (cached !== undefined) return cached;
    if (input.storage.typeFor(subject).kind === "unresolved" ||
      input.storage.boundOriginsFor(subject, bindings).kind === "unresolved") return undefined;
    const root = subject.kind === "input" ? input.records.sourceParameterAbi.get(subject.node)?.parameterCarrier
      : subject.kind === "return" ? input.records.sourceCallableReturn.get(subject.node)?.returnCarrier
      : input.records.runtimeCarrier.get(subject.node)?.carrier;
    const method = subject.projection.some(component => component.kind === "method-value");
    const carrier = subject.projection.length === 0 ? root : method ? inputs.get(subject)?.carrier
      : rustSourceStorageProjectedCarrier(input.carrierHost, subject, root);
    const owner = subject.kind === "return" ? subject.node : subject.kind === "input" ? input.ast.parent(subject.node)
      : sourceEnclosingCallable(input.ast.body(subject.node) === undefined ? subject.node : input.ast.parent(subject.node), input.ast);
    const generic = owner === undefined ? undefined : selectRustNativeStorageGenericBindings({ ...input,
      genericInvocationBindingsFor }, owner, bindings);
    const bound = carrier === undefined || generic?.kind === "unresolved" ? undefined : generic === undefined ? carrier
      : substituteRustTargetGenerics(carrier, generic.bindings.types, generic.bindings.lifetimes, generic.bindings.consts);
    if (bound === undefined) return undefined;
    const selected = snapshotClosedMetadata(bound);
    const entries = previous ?? new Map<SourceStorageBindings, TargetTypeRef>();
    entries.set(bindings, selected);
    logicalCarriers.set(subject, entries);
    return selected;
  };
  const genericInvocationBindingsFor = (declaration: Node, invocation: Node, bindings: SourceStorageBindings,
    arguments_: readonly RustTargetGenericArgument[], caller: RustTargetGenericBindings):
    ReturnType<typeof selectRustSourceCallableInvocationBindings> =>
    input.native.callFor(invocation) !== undefined ? undefined : selectRustSourceCallableInvocationBindings({ ...input,
      extendProducers: selection => recordMembers.extend(selection) }, declaration, invocation, bindings, arguments_, caller);
  const invocationBindingsFor = (implementation: Node, invocation: Node, owner?: Node): SourceStorageBindingsSelection => {
    if (!nodes.has(implementation) || !nodes.has(invocation))
      return unresolved("Native invocation storage requires its exact owned invocation and implementation.");
    if (input.records.targetOperation.get(invocation)?.kind !== "source-call")
      return unresolved("Native invocation storage has no finalized source call.");
    const parent = bindingsFor(owner ?? ownerFor(invocation));
    return parent === undefined ? unresolved("Native invocation storage has no exact caller bindings.")
      : input.storage.bindingsForInvocation(implementation, invocation, parent);
  };
  const invocationInputBindingsFor = (selected: RustNativeCallableInput, invocation: Node,
    owner?: Node): SourceStorageBindingsSelection => {
    const signature = input.records.selectedCall.get(invocation);
    const declaration = asSourceNode(signature?.sourceDeclaration, input.ast);
    if (declaration === undefined || !nodes.has(declaration) ||
      !input.native.inputsFor(declaration).includes(selected) && !input.native.capturesFor(declaration).includes(selected))
      return unresolved("Native invocation input requires its exact callee formal or captured input correspondence.");
    return invocationBindingsFor(declaration, invocation, owner);
  };
  const recordMembers = createRustRecordMemberProducers({ ...input, bindingsFor });
  const select = createRustNativeStorageSelection(input, { inputs, futures, conversions, recordMembers,
    genericInvocationBindingsFor, joinWrites, ownerFor, valueOwnerFor, logicalCarrierFor });
  const selectReturn = (declaration: Node): RustNativeStorageSelection => {
    const result = input.records.sourceCallableReturn.get(declaration);
    const parameter = result?.borrowedParameter;
    if (parameter !== undefined) {
      const abi = input.records.sourceParameterAbi.get(parameter);
      if (input.ast.parent(parameter) !== declaration || sourceCallableValueParameters(input.ast, declaration,
        input.storage.source.semantics.forNode(declaration))?.includes(parameter) !== true ||
        abi?.parameterCarrier.kind !== "reference" || abi.parameterCarrier.mutable ||
        !rustTargetTypeRefEquals(abi.valueCarrier, result?.returnCarrier))
        return unresolved("Native paired return requires its exact source parameter and shared input ABI.");
      const subject = input.storage.subject(parameter, "input");
      return subject.kind === "unresolved" ? subject : select(subject.subject, abi.parameterCarrier, bindingsFor(declaration));
    }
    const carrier = result?.returnCarrier;
    if (carrier === undefined) return unresolved("Native callable return has no finalized logical carrier.");
    const subject = input.storage.subject(declaration, "return");
    return subject.kind === "unresolved" ? subject : select(subject.subject, carrier, bindingsFor(declaration));
  };
  const invocationCallableFor = (node: Node, bindings: SourceStorageBindings | undefined): RustNativeStorageSelection => {
    if (!nodes.has(node)) return unresolved("Native callable invocation requires its exact owned source call.");
    const operation = input.records.targetOperation.get(node);
    const callee = operation?.kind === "source-call" ? Node_Expression(input.ast, node) : undefined;
    const carrier = operation?.kind === "source-call" && operation.target.form === "structural-method"
      ? rustSourceCallCallableStorageCarrier(operation, input.structuralShapes)
      : rustEffectiveValueCarrier(input.records, callee);
    if (callee === undefined || carrier === undefined) return unresolved("Native callable invocation has no exact selected storage contract.");
    const subject = input.storage.subjectFor(callee);
    return subject.kind === "unresolved" ? subject : select(subject.subject, carrier, bindings);
  };
  const witnesses = collectRustNativeAbsenceWitnesses(input, invocationBindingsFor);
  const { absenceWitnesses, argumentWitnesses } = witnesses;
  return Object.freeze({
    logicalCarrierFor,
    issues: witnesses.issues,
    invocationCallableFor: (node: Node) => invocationCallableFor(node, bindingsFor(ownerFor(node))),
    genericBindingsFor(declaration: Node, bindings: SourceStorageBindings): RustNativeStorageGenericSelection {
      return nodes.has(declaration) ? selectRustNativeStorageGenericBindings({ ...input, genericInvocationBindingsFor }, declaration, bindings)
        : unresolved("Native generic activation requires its exact owned declaration.");
    },
    futureEnvironmentFor: futures.forDeclaration,
    returnFor: (declaration: Node) => returns.get(declaration) ?? unpreparedReturn,
    prepareReturn(declaration: Node): RustNativeStorageSelection {
      if (!nodes.has(declaration)) return unresolved("Native callable return requires an owned declaration.");
      const existing = returns.get(declaration);
      if (existing !== undefined) return existing;
      const selection = selectReturn(declaration);
      if (selection.kind !== "unresolved") returns.set(declaration, selection);
      return selection;
    },
    valueFor(node: Node): RustNativeStorageSelection {
      if (!nodes.has(node)) return unresolved("Native callable value requires an owned source node.");
      const carrier = rustEffectiveValueCarrier(input.records, node);
      if (carrier === undefined) return unresolved("Native callable value has no finalized logical carrier.");
      const subject = input.storage.subjectFor(node);
      return subject.kind === "unresolved" ? subject : select(subject.subject, carrier, bindingsFor(valueOwnerFor(node)));
    },
    operandFor(node: Node): RustNativeStorageSelection {
      if (!nodes.has(node)) return unresolved("Native callable operand requires an owned source node.");
      const carrier = rustValueCarrierBeforeContextualConversion(input.records, node);
      if (carrier === undefined) return unresolved("Native callable operand has no finalized logical carrier.");
      const subject = input.storage.subjectFor(node);
      return subject.kind === "unresolved" ? subject
        : select(subject.subject, carrier, bindingsFor(valueOwnerFor(node)), "input");
    },
    subjectFor(subject: SourceStorageSubject, carrier: TargetTypeRef, owner?: Node): RustNativeStorageSelection {
      const checked = input.storage.typeFor(subject);
      return checked.kind === "unresolved" ? checked : select(subject, carrier, bindingsFor(owner ?? ownerFor(subject.node)));
    },
    boundSubjectFor(subject: SourceStorageSubject, carrier: TargetTypeRef, bindings: SourceStorageBindings): RustNativeStorageSelection {
      const selected = input.storage.boundOriginsFor(subject, bindings);
      return selected.kind === "unresolved" ? selected : select(subject, carrier, bindings);
    },
    invocationReturnFor(implementation: Node, invocation: Node, owner?: Node): RustNativeStorageSelection {
      const bindings = invocationBindingsFor(implementation, invocation, owner);
      if (bindings.kind === "unresolved") return bindings;
      const operation = input.records.targetOperation.get(invocation);
      if (operation?.kind !== "source-call") return unresolved("Native invocation return has no finalized source call.");
      const subject = input.storage.subject(implementation, "return");
      return subject.kind === "unresolved" ? subject : select(subject.subject, operation.resultCarrier, bindings.bindings);
    },
    invocationInputFor(selected: RustNativeCallableInput, invocation: Node, owner?: Node): RustNativeStorageSelection {
      if (!ownedInputs.has(selected)) return unresolved("Native invocation input requires its exact owned input identity.");
      const witness = absenceWitnesses.get(invocation)?.get(selected);
      if (witness !== undefined) return Object.freeze({ kind: "selected", carrier: rustSourceOptionalTargetType(witness),
        inputs: Object.freeze([]), sources: Object.freeze([]) });
      const bindings = invocationInputBindingsFor(selected, invocation, owner);
      if (bindings.kind === "unresolved") return bindings;
      const signature = input.records.selectedCall.get(invocation);
      const operation = input.records.targetOperation.get(invocation);
      if (signature === undefined || operation?.kind !== "source-call")
        return unresolved("Native invocation input has no finalized selected signature.");
      const generics = rustTargetGenericBindingsForArguments(signature.member.genericParameters ?? [], operation.targetGenericArguments ?? []);
      return generics === undefined ? unresolved("Native invocation input has no exact selected generic arguments.")
        : select(selected.subject, substituteRustTargetGenerics(selected.carrier, generics.types,
          generics.lifetimes, generics.consts), bindings.bindings);
    },
    invocationWitnessFor: (selected: RustNativeCallableInput, invocation: Node) => absenceWitnesses.get(invocation)?.get(selected),
    invocationArgumentWitnessFor: (invocation: Node, argument: Node) => argumentWitnesses.get(invocation)?.get(argument),
    joinWriteFor: (node: Node) => joinWrites.get(node),
    extendRecordMemberProducers: (selection: SourceStorageProducersSelection) => recordMembers.extend(selection),
    invocationOriginsFor(selected: RustNativeCallableInput, invocation: Node, owner?: Node): SourceStorageSubjectsSelection {
      if (!ownedInputs.has(selected)) return unresolved("Native invocation input requires its exact owned input identity.");
      const bindings = invocationInputBindingsFor(selected, invocation, owner);
      return bindings.kind === "unresolved" ? bindings : input.storage.boundOriginsFor(selected.subject, bindings.bindings);
    },
    implementationOriginsFor(selected: RustNativeCallableInput): SourceStorageProducersSelection {
      return ownedInputs.has(selected) ? input.storage.storageProducersFor(selected.subject, input.storage.emptyBindings)
        : unresolved("Native implementation enumeration requires its exact owned input identity.");
    },
  });
}

import type { RustNativeStorageSelection } from "../../target-model/records/native-storage.js";

import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageBindingsSelection, SourceStorageQueries, SourceStorageSubject, SourceStorageSubjectsSelection, SourceStorageProducersSelection } from "@tsonic/target-api/analysis";
import { isSourceCallableBodyBoundary, sourceEnclosingCallable, sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { instantiateRustSourceUnionPayloads } from "../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustCallableInvocationSignaturesMatch } from "../../policy/conversions/callable-input.js";
import { rustCallableConversionPhysical, rustCallablePhysicalCarrier } from "../../policy/conversions/callable-physical.js";
import type { RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { substituteRustCallableConversion } from "../../target-model/conversions/substitution.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustSourceOptionalTargetType } from "../../target-model/types/projections.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";
import { isRustNativeFutureCarrier, rustFutureOutputCarrier } from "../../target-model/types/carriers/primitives.js";
import { rustUnionAlternatives } from "../../target-model/types/union-relations.js";
import { rustSourceUnionCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { instantiateRustRuntimeUnionPayloads } from "../../target-model/types/carriers/runtime-unions.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustPhysicalPayloadFor } from "../../policy/conversions/physical-payloads.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";
import { rustNativeCallablePhysicalSource, rustNativeCallableInputPhysicalSignature } from "../../policy/conversions/native-callables.js";
import { rustAbsentFutureWitness } from "../../policy/conversions/native-callables.js";
import { asSourceNode } from "@tsonic/target-api/source";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";

import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";
import { rustNativeCallableInvocationArguments } from "../../policy/types/callables/native-invocations.js";
import { createRustNativeStorageGenericSelection, selectRustNativeStorageGenericBindings, rustNativeStorageProjectionSteps, rustNativeStorageProjectionDepth, type RustNativeStorageGenericSelection } from "./native-storage-generics.js";
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
import type { RustPhysicalCallableSourceSelection } from "../../target-model/records/physical-emission-contexts.js";
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
  readonly structuralShapes: RustStructuralStorageLookup;
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
  const { boundaries, adaptedReferences, failure: boundaryFailure } = selectRustNativeConversionBoundaries(input);
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
  const select = (subject: SourceStorageSubject, carrier: TargetTypeRef,
    bindings: SourceStorageBindings | undefined, position: "value" | "input" = "value"): RustNativeStorageSelection => {
    if (bindings === undefined) return unresolved("Native callable storage has no exact declaration-local bindings.");
    const owner = ownerFor(subject.node);
    const environment = owner === undefined ? undefined : futures.forDeclaration(owner);
    if (environment?.kind === "unresolved") return environment;
    const checked = input.storage.typeFor(subject);
    if (checked.kind === "unresolved") return checked;
    if (!isRustTargetTypeRef(carrier)) return unresolved("Native callable storage requires a valid selected carrier.");
    let remaining = rustNativeStorageProjectionSteps;
    let reason: string | undefined;
    const selectedInputs = new Set<RustNativeCallableInput>();
    const erasedPhysicals = new Set<TargetTypeRef>();
    const sources: RustPhysicalCallableSourceSelection[] = [];
    const fail = (message: string): undefined => { reason ??= message; return undefined; };
    const step = (depth: number): boolean => {
      if (remaining-- > 0 && depth <= rustNativeStorageProjectionDepth) return true;
      fail("Native callable storage exceeds its bounded carrier projection budget.");
      return false;
    };
    const genericsFor = createRustNativeStorageGenericSelection({ ...input, step, genericInvocationBindingsFor });
    const { joinProducers, containsCallable } =
      createRustNativeStorageJoins({ input, boundaries, joinWrites, fail, step });
    const project = (subject: SourceStorageSubject, component: SourceStorageSubject["projection"][number]): SourceStorageSubject | undefined => {
      const selected = input.storage.subject(subject.node, subject.kind, [...subject.projection, component]);
      return selected.kind === "resolved" ? selected.subject : fail(selected.reason);
    };
    const formalCarrier = (candidate: RustNativeCallableInput, current: TargetTypeRef): TargetTypeRef | undefined => {
      const candidateCarrier = callableValueCarrier(candidate.carrier);
      if (candidateCarrier === undefined || !rustCallableInvocationSignaturesMatch(current, candidateCarrier))
        return fail("Native callable storage conflicts with its exact input callable contract.");
      selectedInputs.add(candidate);
      return candidate.implementation;
    };
    const inputSignatureMatches = (candidate: RustNativeCallableInput, current: TargetTypeRef): boolean => {
      const candidateCarrier = callableValueCarrier(candidate.carrier);
      return candidateCarrier !== undefined && rustCallableInvocationSignaturesMatch(current, candidateCarrier);
    };
    // The physical carrier of a value that reaches `current` through the finalized callable adapter recorded at `origin`.
    // `optional` reports a target that does not match `current` as absent instead of refusing the whole selection.
    const adaptedPhysical = (origin: SourceStorageSubject, bindings: SourceStorageBindings, current: TargetTypeRef,
      depth: number, optional = false, input_?: RustNativeCallableInput): TargetTypeRef | undefined => {
      const fact = input.records.contextualValueConversion.get(origin.node);
      if (origin.projection.length !== 0 || fact?.conversion.kind !== "callable-adapter" ||
        !rustTargetTypeRefEquals(fact.sourceCarrier, rustValueCarrierBeforeContextualConversion(input.records, origin.node)))
        return fail("Native callable conversion storage requires its exact finalized source and destination contract.");
      const generics = genericsFor(valueOwnerFor(origin.node), bindings, depth + 1);
      if (generics.kind === "unresolved") return fail(generics.reason);
      const { types, lifetimes, consts } = generics.bindings;
      const conversion = substituteRustCallableConversion(fact.conversion, types, lifetimes, consts);
      const target = callableValueCarrier(conversion.target);
      if (target === undefined || !rustCallableInvocationSignaturesMatch(current, target))
        return optional ? undefined : fail("Native callable conversion storage conflicts with its selected activation signature.");
      // An adapted reference to a native input reads that input directly; its storage frontier is the input itself,
      // bound in the activation that creates the adapter.
      const inputImplementation = input_ === undefined ? undefined : formalCarrier(input_, conversion.source);
      const operand = input_ !== undefined
        ? inputImplementation === undefined ? undefined : substituteRustTargetGenerics(inputImplementation, types, lifetimes, consts)
        : visit(conversion.source, origin, bindings, depth + 1, false, "input");
      const physicalInputs = operand === undefined ? [] : [...selectedInputs].filter(candidate =>
        rustTargetTypeRefEquals(candidate.implementation, operand));
      const sourceCarrier = physicalInputs.length === 0 ? conversion.source : physicalInputs.length === 1 &&
        rustCallableInvocationSignaturesMatch(conversion.source, physicalInputs[0]!.carrier)
        ? physicalInputs[0]!.carrier : undefined;
      const source = operand === undefined || sourceCarrier === undefined ? undefined : rustNativeCallablePhysicalSource(sourceCarrier,
        { kind: "selected", carrier: operand, inputs: [...selectedInputs], ...(erasedPhysicals.has(operand) ? { erased: true as const } : {}) });
      const file = input.ast.getSourceFile(origin.node);
      const physical = source === undefined || file === undefined ? undefined
        : rustCallableConversionPhysical(conversion, source.signature, input.ast.getFileName(file), input.definitions,
          source.erased === true)?.carrier;
      return physical ?? fail("Native callable conversion storage has no exact physical adaptation contract.");
    };
    const producerFuture = (origin: SourceStorageSubject, bindings: SourceStorageBindings,
      current: TargetTypeRef, depth: number): TargetTypeRef | undefined => {
      if (origin.kind !== "value" || origin.projection.length !== 0) return undefined;
      const operation = input.records.targetOperation.get(origin.node);
      if (operation?.kind !== "source-call") return undefined;
      const caller = genericsFor(ownerFor(origin.node), bindings, depth + 1);
      if (caller.kind === "unresolved") return fail(caller.reason);
      const logical = substituteRustTargetGenerics(operation.resultCarrier, caller.bindings.types,
        caller.bindings.lifetimes, caller.bindings.consts);
      const nativeCall = input.native.callFor(origin.node);
      if (nativeCall !== undefined) {
        const selected = nativeCall.input;
        const arguments_ = rustNativeCallableInvocationArguments(selected, operation);
        const signature = arguments_ === undefined ? undefined
          : rustNativeCallableInputPhysicalSignature(selected, arguments_);
        if (signature === undefined) return undefined;
        const carrier = substituteRustTargetGenerics(selected.carrier, caller.bindings.types,
          caller.bindings.lifetimes, caller.bindings.consts);
        const physical = visit(carrier, selected.subject, bindings, depth + 1, false);
        const leaf = callableValueCarrier(carrier);
        const implementation = physical === undefined || leaf === undefined ? undefined
          : rustPhysicalPayloadFor(carrier, physical, leaf, input.definitions);
        if (implementation === undefined) return undefined;
        const types = new Map(caller.bindings.types);
        types.set(selected.implementation.identity, implementation);
        const result = substituteRustTargetGenerics(signature.result, types, caller.bindings.lifetimes, caller.bindings.consts);
        return rustPhysicalPayloadFor(logical, result, current, input.definitions);
      }
      // A call of a native Promise body produces that body's own anonymous native Future, not the Promise facade's result.
      if (operation.asyncBody !== undefined) return isRustNativeFutureCarrier(logical) && rustTargetTypeRefEquals(logical, current) ? logical : undefined;
      const implementations = input.storage.invocationImplementationsFor(origin.node, bindings);
      if (implementations.kind !== "resolved" || !implementations.exact || implementations.nodes.length !== 1) return undefined;
      const declaration = implementations.nodes[0]!;
      const activation = input.storage.bindingsForInvocation(declaration, origin.node, bindings);
      if (activation.kind === "unresolved") return fail(activation.reason);
      const generic = genericsFor(declaration, activation.bindings, depth + 1);
      if (generic.kind === "unresolved") return fail(generic.reason);
      const types = new Map(generic.bindings.types);
      const futuresForDeclaration = futures.forDeclaration(declaration);
      if (futuresForDeclaration.kind === "unresolved") return fail(futuresForDeclaration.reason);
      for (const formal of [...input.native.inputsFor(declaration), ...input.native.capturesFor(declaration),
        ...futuresForDeclaration.inputs, ...futuresForDeclaration.captures]) {
        if (!step(depth)) return undefined;
        const logical = substituteRustTargetGenerics(formal.carrier, types, generic.bindings.lifetimes, generic.bindings.consts);
        const physical = visit(logical, formal.subject, activation.bindings, depth + 1, false);
        const leaf = callableValueCarrier(logical);
        const selected = physical === undefined || leaf === undefined ? undefined
          : rustPhysicalPayloadFor(logical, physical, leaf, input.definitions);
        if (selected === undefined) return undefined;
        types.set(formal.implementation.identity, selected);
      }
      const produced = input.producers.invocationResultFor(declaration);
      if (produced === undefined) return undefined;
      const physical = substituteRustTargetGenerics(produced, types, generic.bindings.lifetimes, generic.bindings.consts);
      return rustPhysicalPayloadFor(logical, physical, current, input.definitions);
    };
    const absentOrigin = (subject: SourceStorageSubject) => rustNativeStorageAbsentOrigin(input, subject);
    const erasedUnionCallablePayload = (union: TargetTypeRef | undefined, current: TargetTypeRef) => rustNativeStorageErasedUnionCallablePayload(input, union, current);
    const frameFieldCarrier = (origin: SourceStorageSubject) => rustNativeStorageFrameFieldCarrier(input, origin);
    const erasedClosureParameter = (origin: SourceStorageSubject, current: TargetTypeRef) => rustNativeStorageErasedClosureParameter(input, origin, current);
    const erasedFieldCallable = (origin: SourceStorageSubject, current: TargetTypeRef) => rustNativeStorageErasedFieldCallable(input, origin, current);
    const instanceTypeBindings = (producer: TargetTypeRef, destination: TargetTypeRef) => rustNativeStorageInstanceTypeBindings(producer, destination);
    const frameInstanceBindings = (producer: TargetTypeRef, destination: TargetTypeRef) => rustNativeStorageFrameInstanceBindings(producer, destination);
    const visit = (current: TargetTypeRef, selectedSubject: SourceStorageSubject,
      bindings: SourceStorageBindings, depth: number, permitsAbsence: boolean,
      position: "value" | "input" = "value"): TargetTypeRef | undefined => {
      if (!step(depth)) return undefined;
      const optional = rustOptionElementCarrier(current);
      if (optional !== undefined) {
        const value = visit(optional, selectedSubject, bindings, depth + 1, true, position);
        if (value === undefined || value === optional) return value === undefined ? undefined : current;
        return current.kind === "type-parameter" ? rustSourceOptionalTargetType(value)
          : Object.freeze({ ...current, genericArguments: Object.freeze([Object.freeze({ kind: "type" as const, type: value })]) });
      }
      if (current.kind === "reference") {
        const referent = visit(current.referent, selectedSubject, bindings, depth + 1, permitsAbsence, position);
        return referent === undefined ? undefined : referent === current.referent ? current : Object.freeze({ ...current, referent });
      }
      if (isRustNativeFutureCarrier(current)) {
        const origins = input.storage.boundValueFrontierFor(selectedSubject, bindings, [], position);
        if (origins.kind === "unresolved") return fail(origins.reason);
        let physical: TargetTypeRef | undefined;
        let absent = false;
        for (const origin of origins.frontier) {
          if (!step(depth)) return undefined;
          // An optional Future slot also receives absent values (`return undefined`, a sync callable whose every
          // returned value is absent); they produce no Future, as absent origins of optional callables do below.
          if (permitsAbsence && absentOrigin(origin.subject)) { absent = true; continue; }
          const candidates = futures.forSubject(origin.subject);
          const generics = candidates.length === 0 ? undefined : genericsFor(ownerFor(origin.subject.node), origin.bindings, depth + 1);
          if (generics?.kind === "unresolved") return fail(generics.reason);
          const matching = generics === undefined ? [] : candidates.filter(candidate => rustTargetTypeRefEquals(current,
            substituteRustTargetGenerics(candidate.carrier, generics.bindings.types, generics.bindings.lifetimes, generics.bindings.consts)));
          const candidate = matching.length === 1 ? matching[0]!.implementation
            : candidates.length === 0 ? producerFuture(origin.subject, origin.bindings, current, depth + 1) : undefined;
          if (candidate === undefined)
            return fail("Native Future storage requires its exact physical input or producer contract.");
          if (physical !== undefined && !rustTargetTypeRefEquals(physical, candidate))
            return fail("Native Future storage has distinct physical alternatives requiring a sealed join.");
          physical = Object.isFrozen(candidate) ? candidate : snapshotClosedMetadata(candidate);
        }
        // A slot whose every origin is absent never holds a Future; it is stored with the absent-Future witness.
        const output = physical === undefined && absent ? rustFutureOutputCarrier(current) : undefined;
        return physical ?? (output === undefined ? fail("Native Future storage has no exact physical input implementation.")
          : rustAbsentFutureWitness(output));
      }
      if (rustCallableProtocol(current) !== undefined) {
        if (boundaryFailure !== undefined) return fail(boundaryFailure);
        const operation = selectedSubject.kind === "value" && selectedSubject.projection.length === 0
          ? input.records.targetOperation.get(selectedSubject.node) : undefined;
        const property = operation?.kind === "source-field" && operation.storage === "structural-object"
          ? input.structuralShapes.field(operation.receiverCarrier, operation.storageIndex) : undefined;
        if (operation?.kind === "source-field" && property?.storage === "property" && property.method !== true) {
          const generics = genericsFor(ownerFor(selectedSubject.node), bindings, depth + 1);
          if (generics.kind === "unresolved") return fail(generics.reason);
          const carrier = callableValueCarrier(substituteRustTargetGenerics(operation.resultCarrier,
            generics.bindings.types, generics.bindings.lifetimes, generics.bindings.consts));
          const physical = carrier === undefined || !rustCallableInvocationSignaturesMatch(current, carrier)
            ? undefined : rustCallablePhysicalCarrier(carrier);
          if (physical === undefined) return fail("A structural callable property requires its exact selected getter storage.");
          erasedPhysicals.add(physical);
          return physical;
        }
        const selected = input.storage.boundValueFrontierFor(selectedSubject, bindings, boundaries, position);
        if (selected.kind === "unresolved") return fail(selected.reason);
        let physical: TargetTypeRef | undefined;
        let distinct = false;
        let joinable = true;
        const alternatives = new Map<SourceStorageSubject, TargetTypeRef>();
        const absent = new Set<SourceStorageSubject>();
        for (const frontier of selected.frontier) {
          if (!step(depth)) return undefined;
          const origin = frontier.subject;
          let candidatePhysical: TargetTypeRef | undefined;
          if (frontier.kind === "boundary") {
            joinable = false;
            candidatePhysical = adaptedPhysical(origin, frontier.bindings, current, depth);
            if (candidatePhysical === undefined) return undefined;
          } else {
            const candidate = inputs.get(origin);
            if (candidate !== undefined) joinable = false;
            const adapted = candidate === undefined ? undefined : adaptedReferences.get(origin.node);
            if (candidate !== undefined && adapted !== undefined && !inputSignatureMatches(candidate, current)) {
              // The input reaches this formal only through an adapted reference whose target is the formal's signature.
              for (const reference of adapted) {
                const fact = input.records.contextualValueConversion.get(reference.node);
                const target = fact?.conversion.kind === "callable-adapter" ? callableValueCarrier(fact.conversion.target) : undefined;
                if (target === undefined || ownerFor(reference.node) !== ownerFor(origin.node)) continue;
                const selectedPhysical = adaptedPhysical(reference.subject, frontier.bindings, current, depth, true, candidate);
                if (selectedPhysical === undefined) continue;
                if (candidatePhysical !== undefined && !rustTargetTypeRefEquals(candidatePhysical, selectedPhysical))
                  return fail("Native callable storage has distinct adapted input alternatives requiring a sealed join.");
                candidatePhysical = selectedPhysical;
              }
              if (candidatePhysical === undefined) return fail("Native callable storage conflicts with its exact input callable contract.");
            } else if (candidate !== undefined) candidatePhysical = formalCarrier(candidate, current);
            else {
              const originCarrier = origin.projection.length === 0
                ? input.records.receiverIndependentMethod.get(origin.node)?.carrier ?? input.records.runtimeCarrier.get(origin.node)?.carrier
                : frameFieldCarrier(origin);
              // A callable parameter of an owner emitted as a closure value is a concrete runtime callable supplied by
              // the caller; its physical carrier is its declared parameter carrier, with no producer of its own.
              const concreteParameter = origin.kind === "input" && origin.projection.length === 0 &&
                input.native.isConcreteCallableParameter(origin.node)
                ? input.records.sourceParameterAbi.get(origin.node)?.parameterCarrier : undefined;
              if (concreteParameter !== undefined) {
                const element = rustOptionElementCarrier(concreteParameter) ?? concreteParameter;
                const declared = rustCallablePhysicalCarrier(element);
                if (declared === undefined || !rustCallableInvocationSignaturesMatch(current, callableValueCarrier(element) ?? element))
                  return fail("Native callable storage conflicts with its exact concrete callable parameter.");
                joinable = false;
                if (physical !== undefined && !rustTargetTypeRefEquals(physical, declared))
                  return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
                physical = declared;
                alternatives.set(origin, declared);
                continue;
              }
              if (permitsAbsence && isRustAbsenceCarrier(originCarrier)) {
                absent.add(origin);
                continue;
              }
              // A callable narrowed out of a union-typed value is the union's stored payload for that member, which
              // is already a type-erased runtime callable; it has no separate producer implementation.
              // Likewise a class field declared as a type-erased runtime callable stores that erased callable.
              const erasedParameter = origin.projection.length === 0 && origin.kind === "input" ? erasedClosureParameter(origin, current) : undefined;
              if (erasedParameter !== undefined) erasedPhysicals.add(erasedParameter);
              // A union-typed parameter (`callback: string | Numeric`) narrowed to its callable member reads the union's
              // erased payload like any other union-typed value.
              const unionPayload = origin.projection.length === 0
                ? erasedParameter ?? erasedUnionCallablePayload(originCarrier, current) : erasedFieldCallable(origin, current);
              if (unionPayload !== undefined) {
                joinable = false;
                candidatePhysical = unionPayload;
                if (physical !== undefined && !rustTargetTypeRefEquals(physical, candidatePhysical))
                  return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
                physical = candidatePhysical;
                continue;
              }
              const generics = genericsFor(sourceEnclosingCallable(input.ast.parent(origin.node), input.ast), frontier.bindings, depth + 1);
              if (generics.kind === "unresolved") return fail(generics.reason);
              const { types, lifetimes, consts } = generics.bindings;
              const ownerBound = originCarrier === undefined ? undefined
                : callableValueCarrier(substituteRustTargetGenerics(originCarrier, types, lifetimes, consts));
              // A class-level field initializer has no enclosing activation; the owning class's type parameters are
              // instantiated by the instance the field is read from, which the destination signature carries.
              const classBindings = ownerBound === undefined || rustCallableInvocationSignaturesMatch(current, ownerBound)
                ? undefined : instanceTypeBindings(ownerBound, current);
              const boundCarrier = classBindings === undefined ? ownerBound
                : callableValueCarrier(substituteRustTargetGenerics(ownerBound!, classBindings, new Map(), new Map()));
              const produced = originCarrier === undefined || boundCarrier === undefined || !rustCallableInvocationSignaturesMatch(mapRustTargetTypes(current, input.normalizeTypeFamily),
                  mapRustTargetTypes(boundCarrier, input.normalizeTypeFamily))
                ? undefined : rustFrameCallableValue(originCarrier) !== undefined
                  ? originCarrier : input.producers.physicalFor(origin.node, originCarrier);
              const classBound = produced === undefined || classBindings === undefined ? produced
                : substituteRustTargetGenerics(produced, classBindings, new Map(), new Map());
              // A field write made in a method body of a generic class is reached with that method's declaration
              // bindings; the instance whose field is read supplies the class type arguments.
              const readInstance = classBound === undefined ? undefined : frameInstanceBindings(classBound, current);
              const instantiated = classBound === undefined || readInstance === undefined ? classBound
                : substituteRustTargetGenerics(classBound, readInstance, new Map(), new Map());
              candidatePhysical = instantiated === undefined ? undefined : substituteRustTargetGenerics(instantiated, types, lifetimes, consts);
            }
            if (candidatePhysical === undefined)
              return fail("Native callable storage has a producer without a sealed physical implementation.");
          }
          alternatives.set(origin, candidatePhysical);
          if (physical === undefined || rustTargetTypeRefEquals(physical, candidatePhysical)) physical = candidatePhysical;
          else distinct = true;
        }
        if (!distinct) return physical ?? fail("Native callable storage has no selected physical input implementation.");
        // Inputs and conversion boundaries keep one physical implementation: no signature-based choice among them.
        return joinable ? joinProducers(selectedSubject, bindings, position, alternatives, absent)
          : fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
      }
      if (rustGenericCallableValue(current) !== undefined) {
        const origins = input.storage.boundOriginsFor(selectedSubject, bindings);
        if (origins.kind === "unresolved") return fail(origins.reason);
        const materialized = (origin: SourceStorageSubject): boolean => origin.kind !== "return" || origin.projection.length !== 0 ||
          !isRustNeverCarrier(input.records.sourceCallableReturn.get(origin.node)?.returnCarrier);
        const values = origins.subjects.filter(materialized);
        const storedMethodValue = (origin: SourceStorageSubject): boolean =>
          origin.kind === "input" && origin.projection[origin.projection.length - 1]?.kind === "method-value";
        // Generic methods read from inputs are those inputs' stored generic callable family values.
        if (values.length !== 0 && values.every(storedMethodValue)) return current;
        if (values.every(origin => !inputs.has(origin))) {
          const producers = recordMembers.extend(input.storage.storageProducersFor(selectedSubject, bindings));
          if (producers.kind !== "complete") return fail(producers.kind === "unresolved" ? producers.reason
            : "A generic callable physical environment requires its exact closed source producers.");
          const present = producers.producers.filter(producer => materialized(producer.subject) &&
            (!permitsAbsence || producer.subject.projection.length !== 0 ||
              !isRustAbsenceCarrier(input.records.runtimeCarrier.get(producer.subject.node)?.carrier)));
          const ownerFileName = recordMembers.ownerFileFor(producers) ?? input.ast.getFileName(input.ast.getSourceFile(selectedSubject.node));
          const physical = input.physicalCarrierFor(current, ownerFileName, selectedSubject, bindings, present);
          if (physical === undefined) return fail("A generic callable producer lacks its exact bound physical capture environment.");
          for (const selected of physical.inputs) selectedInputs.add(selected);
          for (const source of physical.sources) sources.push(source);
          return physical.carrier;
        }
        let physical: TargetTypeRef | undefined;
        for (const origin of values) {
          if (!step(depth)) return undefined;
          const candidate = inputs.get(origin);
          let candidatePhysical: TargetTypeRef | undefined;
          if (storedMethodValue(origin)) {
            // A generic method read from an input is the input's stored generic callable family value (structural
            // methods are stored with the receiver first), not a callable input type parameter.
            candidatePhysical = current;
          } else if (candidate === undefined) {
            const originCarrier = origin.projection.length === 0
              ? input.records.runtimeCarrier.get(origin.node)?.carrier : undefined;
            if (permitsAbsence && isRustAbsenceCarrier(originCarrier)) continue;
            candidatePhysical = origin.projection.length === 0
              ? input.producers.physicalFor(origin.node, current) : undefined;
            if (candidatePhysical === undefined)
              return fail("Native callable storage has a producer without a sealed physical implementation.");
          } else {
            candidatePhysical = formalCarrier(candidate, current);
            if (candidatePhysical === undefined) return undefined;
          }
          if (physical !== undefined && !rustTargetTypeRefEquals(physical, candidatePhysical))
            return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
          physical = candidatePhysical;
        }
        return physical ?? fail("Native callable storage has no selected physical input implementation.");
      }
      if (current.kind === "array" || current.kind === "slice") {
        const component = project(selectedSubject, { kind: "array-element" });
        const element = component === undefined ? undefined : visit(current.element, component, bindings, depth + 1, false, position);
        return element === undefined ? undefined : element === current.element ? current : Object.freeze({ ...current, element });
      }
      if (current.kind === "tuple") {
        const elements: TargetTypeRef[] = [];
        for (const [index, element] of current.elements.entries()) {
          const component = project(selectedSubject, { kind: "tuple-element", index });
          const selected = component === undefined ? undefined : visit(element, component, bindings, depth + 1, false, position);
          if (selected === undefined) return undefined;
          elements.push(selected);
        }
        return elements.every((element, index) => element === current.elements[index]) ? current
          : Object.freeze({ ...current, elements: Object.freeze(elements) });
      }
      const variants = rustUnionAlternatives(current, input.definitions);
      if (variants !== undefined) {
        const payloads = variants.map(variant => visit(variant.carrier, selectedSubject, bindings, depth + 1, permitsAbsence, position));
        if (payloads.some(payload => payload === undefined)) return undefined;
        if (payloads.every((payload, index) => payload === variants[index]!.carrier)) return current;
        const selected = rustSourceUnionCarrierValue(current) === undefined
          ? instantiateRustRuntimeUnionPayloads(current, payloads as TargetTypeRef[])
          : instantiateRustSourceUnionPayloads(current, payloads as TargetTypeRef[], input.definitions);
        return selected ?? fail("Native physical union storage requires its exact canonical payload template.");
      }
      const nested = containsCallable(current, depth + 1);
      return nested === undefined ? undefined : nested
        ? fail("Native callable storage requires its existing physical aggregate layout owner.") : current;
    };
    const physical = visit(carrier, subject, bindings, 0, false, position);
    const selectedSources = Object.freeze(sources);
    return physical === undefined ? unresolved(reason ?? "Native callable storage has no exact physical selection.")
      : rustTargetTypeRefEquals(physical, carrier) ? Object.freeze({ kind: "identity", carrier, sources: selectedSources })
        : Object.freeze({ kind: "selected", carrier: physical, inputs: Object.freeze([...selectedInputs]), sources: selectedSources,
          ...(erasedPhysicals.has(physical) ? { erased: true as const } : {}) });
  };
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
  const recordMembers = createRustRecordMemberProducers({ ...input, bindingsFor });
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
import { callableValueCarrier } from "./native-storage-values.js";
import { createRustNativeStorageJoins } from "./native-storage-joins.js";
import { rustNativeStorageAbsentOrigin, rustNativeStorageErasedUnionCallablePayload, rustNativeStorageFrameFieldCarrier, rustNativeStorageErasedClosureParameter, rustNativeStorageErasedFieldCallable, rustNativeStorageInstanceTypeBindings, rustNativeStorageFrameInstanceBindings } from "./native-storage-carriers.js";

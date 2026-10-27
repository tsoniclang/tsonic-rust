import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";

import { instantiateRustSourceUnionPayloads } from "../../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";
import { rustCallableInvocationSignaturesMatch } from "../../../policy/conversions/callable-input.js";
import { rustCallableConversionPhysical, rustCallablePhysicalCarrier } from "../../../policy/conversions/callable-physical.js";

import { substituteRustCallableConversion } from "../../../target-model/conversions/substitution.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustSourceOptionalTargetType } from "../../../target-model/types/projections.js";
import { isRustAbsenceCarrier } from "../../../target-model/types/carriers/native.js";
import { isRustNativeFutureCarrier, rustFutureOutputCarrier } from "../../../target-model/types/carriers/primitives.js";
import { rustUnionAlternatives } from "../../../target-model/types/union-relations.js";
import { rustCallableTargetId, rustLocationTargetId, rustSourceUnionCarrierValue, rustSourceTypeCarrierValue, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType, rustStructuralObjectCarrierName } from "../../../target-model/types/carriers/source-types.js";
import { inferRustTargetGenericBindings } from "../../../target-model/types/carriers/generic-inference.js";
import { rustLifetimeKey, rustLifetimesEqual, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { instantiateRustRuntimeUnionPayloads } from "../../../target-model/types/carriers/runtime-unions.js";

import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../../target-model/types/carriers/substitution.js";
import { rustPhysicalPayloadFor } from "../../../policy/conversions/physical-payloads.js";
import { snapshotClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import { rustValueCarrierBeforeContextualConversion } from "../../conversions/value-carrier-queries.js";
import { rustAbsentFutureWitness, rustNativeCallablePhysicalSource, rustNativeCallableInputPhysicalSignature } from "../../../policy/conversions/native-callables.js";

import { isRustNeverCarrier, rustJsArrayLikeElementTargetType } from "../../../target-model/types/carriers/js.js";
import { rustTypeGenericArguments } from "../../../target-model/types/generic-arguments.js";

import { rustNativeCallableInvocationArguments } from "../../../policy/types/callables/native-invocations.js";
import { createRustNativeStorageGenericSelection, rustNativeStorageProjectionSteps, rustNativeStorageProjectionDepth } from "./native-storage-generics.js";
import { createRustNativeFutureInputPlan } from "../native/native-future-inputs.js";
import { selectRustNativeConversionBoundaries } from "./native-storage-witnesses.js";
import { createRustRecordMemberProducers } from "./native-storage-members.js";

import type { RustNativeCallableInput } from "../../../target-model/records/native/native-protocols.js";
import type { RustNativeCallablePhysicalSource } from "../../../target-model/records/callables/callable-conversions.js";
import type { RustStructuralPhysicalCompletionEvidence } from "../../objects/shapes/structural-shape-plan.js";

import type { RustPhysicalCallableSourceSelection } from "../../../target-model/records/native/physical-emission-contexts.js";
import type { RustCallableJoinWrite } from "../../../target-model/records/native/native-storage.js";
import { selectRustNativeArrayStorage, selectRustNativeCollectionStorage } from "./native-storage-collections.js";
import { selectRustJsStoredTypeArgumentSlots } from "../../../policy/operations/source-profiles/js/stored-slots.js";
import type { RustNativeStorageSelection } from "../../../target-model/records/native/native-storage.js";
import { callableValueCarrier } from "./native-storage-values.js";
import { createRustNativeStorageJoins } from "./native-storage-joins.js";
import { rustNativeStorageAbsentOrigin, rustNativeStorageErasedUnionCallablePayload, rustNativeStorageFrameFieldCarrier, rustNativeStorageErasedClosureParameter, rustNativeStorageErasedFieldCallable, rustNativeStorageInstanceTypeBindings, rustNativeStorageFrameInstanceBindings } from "./native-storage-carriers.js";
import type { createRustNativeStorageQueries, RustNativeInvocationBindingsSelection } from "./native-storage.js";
import { snapshotRustCallableBindings } from "../../../policy/types/callables/generic-bindings.js";
import type { RustSourceErrorEffectSelection } from "../../errors/source-error-effects.js";
import { selectRustNativeCallbackParameterStorage } from "../native/native-parameters.js";
import { selectRustTypedLocationSourceOperation } from "../../../source/extension/typed-locations.js";

type RustNativeStorageRequest = {
  readonly subject: SourceStorageSubject;
  readonly bindings: SourceStorageBindings | undefined;
  readonly scope: Node | undefined;
} & (
  | { readonly kind: "value"; readonly carrier: TargetTypeRef; readonly position: "value" | "input" }
  | { readonly kind: "invocation"; readonly declaration: Node }
);

export function createRustNativeStorageSelection(
  input: Parameters<typeof createRustNativeStorageQueries>[0],
  prepared: {
    readonly inputs: ReadonlyMap<SourceStorageSubject, RustNativeCallableInput>;
    readonly futures: ReturnType<typeof createRustNativeFutureInputPlan>;
    readonly conversions: ReturnType<typeof selectRustNativeConversionBoundaries>;
    readonly recordMembers: ReturnType<typeof createRustRecordMemberProducers>;
    readonly genericInvocationBindingsFor: Parameters<typeof createRustNativeStorageGenericSelection>[0]["genericInvocationBindingsFor"];
    readonly joinWrites: Map<Node, RustCallableJoinWrite>;
    readonly ownerFor: (node: Node) => Node | undefined;
    readonly valueOwnerFor: (node: Node) => Node | undefined;
    readonly logicalCarrierFor: (subject: SourceStorageSubject, bindings: SourceStorageBindings) => TargetTypeRef | undefined;
    readonly completeNativeOrigin: (node: Node, declaration: Node, carrier: TargetTypeRef,
      activation: NonNullable<Parameters<RustSourceErrorEffectSelection["bindingsFor"]>[3]>) => TargetTypeRef | undefined;
  },
) {
  const { inputs, futures, recordMembers, genericInvocationBindingsFor, joinWrites, ownerFor, valueOwnerFor, logicalCarrierFor } = prepared;
  const { boundaries, adaptedReferences, failure: boundaryFailure } = prepared.conversions;
  const unresolved = (reason: string): Extract<RustNativeStorageSelection, { readonly kind: "unresolved" }> =>
    Object.freeze({ kind: "unresolved", reason });
  function evaluate(request: Extract<RustNativeStorageRequest, { readonly kind: "value" }>): RustNativeStorageSelection;
  function evaluate(request: Extract<RustNativeStorageRequest, { readonly kind: "invocation" }>): RustNativeInvocationBindingsSelection;
  function evaluate(request: RustNativeStorageRequest): RustNativeStorageSelection | RustNativeInvocationBindingsSelection {
    const { subject, bindings, scope } = request;
    const position = request.kind === "value" ? request.position : "value";
    if (bindings === undefined) return unresolved("Native callable storage has no exact declaration-local bindings.");
    const owner = ownerFor(subject.node);
    const availableNativeInputs = scope === undefined ? [] : [...input.native.inputsFor(scope), ...input.native.capturesFor(scope)];
    const environment = owner === undefined ? undefined : futures.forDeclaration(owner);
    if (environment?.kind === "unresolved") return environment;
    const checked = input.storage.typeFor(subject);
    if (checked.kind === "unresolved") return checked;
    if (request.kind === "value" && !isRustTargetTypeRef(request.carrier))
      return unresolved("Native callable storage requires a valid selected carrier.");
    let remaining = rustNativeStorageProjectionSteps;
    let reason: string | undefined;
    const selectedInputs = new Set<RustNativeCallableInput>();
    const erasedPhysicals = new Set<TargetTypeRef>();
    const sources: RustPhysicalCallableSourceSelection[] = [];
    const fail = (message: string): undefined => { reason ??= message; return undefined; };
    const selectionFor = (physical: TargetTypeRef | undefined, logical: TargetTypeRef): RustNativeStorageSelection => {
      const selectedSources = Object.freeze([...sources]);
      return physical === undefined ? unresolved(reason ?? "Native callable storage has no exact physical selection.")
        : rustTargetTypeRefEquals(physical, logical) ? Object.freeze({ kind: "identity", carrier: physical, sources: selectedSources })
          : Object.freeze({ kind: "selected", carrier: physical, inputs: Object.freeze([...selectedInputs]), sources: selectedSources,
            ...(erasedPhysicals.has(physical) ? { erased: true as const } : {}) });
    };
    const step = (depth: number): boolean => {
      if (remaining-- > 0 && depth <= rustNativeStorageProjectionDepth) return true;
      fail("Native callable storage exceeds its bounded carrier projection budget.");
      return false;
    };
    const genericsFor = createRustNativeStorageGenericSelection({ ...input, step, genericInvocationBindingsFor });
    const { joinProducers, requiresPhysicalSelection } =
      createRustNativeStorageJoins({ input, boundaries, joinWrites, fail, step });
    const project = (subject: SourceStorageSubject, component: SourceStorageSubject["projection"][number]): SourceStorageSubject | undefined => {
      const selected = input.storage.subject(subject.node, subject.kind, [...subject.projection, component]);
      return selected.kind === "resolved" ? selected.subject : fail(selected.reason);
    };
    const formalCarrier = (candidate: RustNativeCallableInput, current: TargetTypeRef,
      bindings: SourceStorageBindings, depth: number): TargetTypeRef | undefined => {
      const generic = genericsFor(candidate.owner, bindings, depth + 1);
      if (generic.kind === "unresolved") return fail(generic.reason);
      const candidateCarrier = callableValueCarrier(substituteRustTargetGenerics(candidate.carrier,
        generic.bindings.types, generic.bindings.lifetimes, generic.bindings.consts));
      if (candidateCarrier === undefined || !rustCallableInvocationSignaturesMatch(current, candidateCarrier))
        return fail("Native callable storage conflicts with its exact input callable contract.");
      selectedInputs.add(candidate);
      return substituteRustTargetGenerics(candidate.implementation, generic.bindings.types,
        generic.bindings.lifetimes, generic.bindings.consts);
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
      const inputImplementation = input_ === undefined ? undefined : formalCarrier(input_, conversion.source, bindings, depth);
      const operand = input_ !== undefined
        ? inputImplementation === undefined ? undefined : substituteRustTargetGenerics(inputImplementation, types, lifetimes, consts)
        : visit(conversion.source, origin, bindings, depth + 1, false, "input");
      const physicalInputs = operand === undefined ? [] : [...selectedInputs].filter(candidate =>
        rustTargetTypeRefEquals(candidate.implementation, operand));
      const selectedInput = physicalInputs.length === 1 ? physicalInputs[0] : undefined;
      const selectedCarrier = selectedInput === undefined ? undefined : substituteRustTargetGenerics(selectedInput.carrier,
        types, lifetimes, consts);
      const originalSignature = selectedInput === undefined || selectedCarrier === undefined ||
        !rustCallableInvocationSignaturesMatch(conversion.source, selectedCarrier) ? undefined
        : rustNativeCallableInputPhysicalSignature(selectedInput, []);
      const source: RustNativeCallablePhysicalSource | undefined = operand === undefined ? undefined : physicalInputs.length === 0
        ? rustNativeCallablePhysicalSource(conversion.source,
          { kind: "selected", carrier: operand, inputs: [...selectedInputs], ...(erasedPhysicals.has(operand) ? { erased: true as const } : {}) },
          input.frames)
        : originalSignature === undefined || selectedInput === undefined ? undefined : Object.freeze({ carrier: operand, input: selectedInput,
          signature: Object.freeze({
            parameters: Object.freeze(originalSignature.parameters.map(parameter => substituteRustTargetGenerics(parameter, types, lifetimes, consts))),
            result: substituteRustTargetGenerics(originalSignature.result, types, lifetimes, consts),
            error: substituteRustTargetGenerics(originalSignature.error, types, lifetimes, consts),
          }) });
      const file = input.ast.getSourceFile(origin.node);
      const physical = source === undefined || file === undefined ? undefined
        : rustCallableConversionPhysical(conversion, source.signature, input.ast.getFileName(file), input.definitions,
          source.erased === true)?.carrier;
      return physical ?? fail("Native callable conversion storage has no exact physical adaptation contract.");
    };
    const boundInvocation = (declaration: Node, invocation: Node, callerBindings: SourceStorageBindings,
      depth: number): Extract<RustNativeInvocationBindingsSelection, { readonly kind: "resolved" }> | undefined => {
      if (!step(depth)) return undefined;
      const operation = input.records.targetOperation.get(invocation);
      if (operation?.kind !== "source-call") return fail("Native invocation binding requires its original source call.");
      const implementations = input.storage.invocationImplementationsFor(invocation, callerBindings);
      if (implementations.kind !== "resolved" || !implementations.exact || implementations.nodes.length !== 1 ||
        implementations.nodes[0] !== declaration || operation.asyncBody !== undefined && operation.asyncBody.declaration !== declaration)
        return fail("Native invocation binding requires its identical unique selected implementation.");
      const activation = input.storage.bindingsForInvocation(declaration, invocation, callerBindings);
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
      return Object.freeze({ kind: "resolved", storageBindings: activation.bindings,
        targetBindings: snapshotRustCallableBindings({ types, lifetimes: generic.bindings.lifetimes, consts: generic.bindings.consts }) });
    };
    const producerResult = (origin: SourceStorageSubject, bindings: SourceStorageBindings,
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
        const callIdentity = sourceNodeIdentity(input.ast, origin.node);
        const arguments_ = callIdentity === undefined ? undefined
          : rustNativeCallableInvocationArguments(selected, operation, callIdentity);
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
      const implementations = input.storage.invocationImplementationsFor(origin.node, bindings);
      if (implementations.kind !== "resolved" || !implementations.exact || implementations.nodes.length !== 1) return undefined;
      const declaration = implementations.nodes[0]!;
      const bound = boundInvocation(declaration, origin.node, bindings, depth);
      if (bound === undefined) return undefined;
      const produced = operation.asyncBody === undefined ? input.producers.invocationResultFor(declaration)
        : input.producers.bodyResultFor(declaration);
      if (produced === undefined) return undefined;
      const physical = substituteRustTargetGenerics(produced, bound.targetBindings.types,
        bound.targetBindings.lifetimes, bound.targetBindings.consts);
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
      const location = current.kind === "target-named" && current.id === rustLocationTargetId ? current : undefined;
      const pointee = current.kind === "pointer" ? current.pointee : location?.genericArguments?.[0]?.kind === "type"
        ? location.genericArguments[0].type : undefined;
      if (pointee !== undefined) {
        const needed = requiresPhysicalSelection(pointee, depth + 1);
        if (needed === undefined) return undefined;
        if (!needed) return current;
        const origins = input.storage.storageProducersFor(selectedSubject, bindings);
        if (origins.kind !== "complete") return fail(origins.kind === "unresolved" ? origins.reason
          : "A native callable pointer requires the complete checked allocation provenance of its pointee.");
        let selected: TargetTypeRef | undefined;
        for (const origin of origins.producers) {
          const subject = origin.subject;
          const operation = subject.kind === "value" && subject.projection.length === 0
            ? input.records.targetOperation.get(subject.node) : undefined;
          const sourceOperation = operation?.kind === "typed-location" && operation.operation === "allocate"
            ? selectRustTypedLocationSourceOperation(subject.node, "allocate",
              (subject, key) => input.storage.source.sourceFacts.getFact(subject, key)) : undefined;
          const plan = sourceOperation?.kind === "selected" ? sourceOperation.sourceOperation : undefined;
          let candidate: TargetTypeRef | undefined;
          if (operation?.kind === "typed-location" && operation.operation === "allocate") {
            if (plan?.operation !== "allocate" || plan.call !== subject.node)
              return fail("A native callable allocation requires its original checked initialization evidence.");
            const source = input.storage.subjectFor(plan.initialExpression);
            if (source.kind === "unresolved") return fail(source.reason);
            candidate = visit(pointee, source.subject, origin.bindings, depth + 1, false, position);
          } else {
            const physical = producerResult(subject, origin.bindings, current, depth + 1);
            candidate = physical?.kind === "pointer" ? physical.pointee
              : physical?.kind === "target-named" && physical.id === rustLocationTargetId && physical.genericArguments?.[0]?.kind === "type"
                ? physical.genericArguments[0].type : undefined;
          }
          if (candidate === undefined) return fail("A native callable pointer requires its original finite allocation and exact physical pointee.");
          if (selected !== undefined && !rustTargetTypeRefEquals(selected, candidate))
            return fail("A native callable pointer cannot combine allocations with different physical pointee representations.");
          selected = candidate;
        }
        if (selected === undefined) return fail("A native callable pointer has no original checked allocation.");
        return current.kind === "pointer" ? Object.freeze({ ...current, pointee: selected })
          : Object.freeze({ ...location!, genericArguments: Object.freeze(location!.genericArguments!.map((argument, index) =>
            index === 0 ? Object.freeze({ kind: "type" as const, type: selected! }) : argument)) });
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
            : candidates.length === 0 ? producerResult(origin.subject, origin.bindings, current, depth + 1) : undefined;
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
        const concreteInput = (origin: SourceStorageSubject, sourceBindings: SourceStorageBindings): TargetTypeRef | undefined => {
          const logical = logicalCarrierFor(origin, sourceBindings);
          const element = logical === undefined ? undefined : callableValueCarrier(logical);
          const callback = selectRustNativeCallbackParameterStorage(input, origin, sourceBindings,
            (source, carrier, bindings) => selectionFor(visit(carrier, source, bindings, depth + 1, false, "input"), carrier));
          if (callback?.kind === "unresolved") return fail(callback.reason);
          const contract = callback === undefined ? element : callableValueCarrier(callback.carrier);
          const declared = contract === undefined ? undefined : rustCallablePhysicalCarrier(contract);
          if (declared === undefined || element === undefined || !rustCallableInvocationSignaturesMatch(current, element))
            return fail("Native callable storage conflicts with its exact concrete callable parameter.");
          if (callback?.kind === "selected") for (const selected of callback.inputs) selectedInputs.add(selected);
          for (const source of callback?.sources ?? []) if (!sources.includes(source)) sources.push(source);
          if (callback?.kind === "selected" && callback.erased === true ||
            contract?.kind === "target-named" && contract.id === rustCallableTargetId) erasedPhysicals.add(declared);
          return declared;
        };
        if (selectedSubject.kind === "input" && input.native.isConcreteCallableStorage(selectedSubject) === true)
          return concreteInput(selectedSubject, bindings);
        if (rustFrameCallableValue(current) !== undefined && selectedSubject.kind === "member" &&
          selectedSubject.projection.length === 0) {
          const stored = input.frames.bindingFor(selectedSubject.node)?.carrier;
          return stored !== undefined && rustTargetTypeRefEquals(stored, current) ? stored
            : fail("A native frame field requires its exact completed physical binding.");
        }
        const selectedCallableRead = (origin: SourceStorageSubject, sourceBindings: SourceStorageBindings, readPosition: "value" | "input"):
          | { readonly kind: "not-read" }
          | { readonly kind: "selected"; readonly carrier: TargetTypeRef }
          | { readonly kind: "unresolved" } => {
          const operation = origin.kind === "value" && origin.projection.length === 0
            ? input.records.targetOperation.get(origin.node) : undefined;
          const property = operation?.kind === "source-field" && operation.storage === "structural-object"
            ? input.structuralShapes.field(operation.receiverCarrier, operation.storageIndex) : undefined;
          const boundMethod = operation?.kind === "source-method-property" &&
            (operation.accessMode === "read" || operation.accessMode === "read-write");
          if (!boundMethod && (operation?.kind !== "source-field" || property?.storage !== "property" || property.method === true))
            return { kind: "not-read" };
          const conversion = input.records.contextualValueConversion.get(origin.node);
          if (readPosition === "value" && conversion?.conversion.kind === "callable-adapter") {
            const physical = adaptedPhysical(origin, sourceBindings, current, depth);
            return physical === undefined ? { kind: "unresolved" } : { kind: "selected", carrier: physical };
          }
          const generics = genericsFor(ownerFor(origin.node), sourceBindings, depth + 1);
          if (generics.kind === "unresolved") {
            fail(generics.reason);
            return { kind: "unresolved" };
          }
          const carrier = callableValueCarrier(substituteRustTargetGenerics(operation.resultCarrier,
            generics.bindings.types, generics.bindings.lifetimes, generics.bindings.consts));
          const physical = carrier === undefined || !rustCallableInvocationSignaturesMatch(current, carrier)
            ? undefined : rustFrameCallableValue(carrier) !== undefined && rustTargetTypeRefEquals(carrier, current)
              ? carrier : rustCallablePhysicalCarrier(carrier);
          if (physical === undefined) {
            fail("A callable property read requires its exact selected native storage.");
            return { kind: "unresolved" };
          }
          if (rustFrameCallableValue(physical) === undefined) erasedPhysicals.add(physical);
          return { kind: "selected", carrier: physical };
        };
        const directRead = selectedCallableRead(selectedSubject, bindings, position);
        if (directRead.kind !== "not-read") return directRead.kind === "selected" ? directRead.carrier : undefined;
        const selected = input.storage.boundValueFrontierFor(selectedSubject, bindings, boundaries, position);
        if (selected.kind === "unresolved") return fail(selected.reason);
        if (selected.frontier.length === 0) {
          const producers = input.storage.storageProducersFor(selectedSubject, bindings);
          if (producers.kind === "unresolved") return fail(producers.reason);
          if (producers.kind === "complete" && producers.producers.length === 0) {
            const physical = rustCallablePhysicalCarrier(current);
            if (physical === undefined) return fail("Empty callable storage requires its exact declared physical contract.");
            if (current.kind === "target-named" && current.id === rustCallableTargetId) erasedPhysicals.add(physical);
            return physical;
          }
        }
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
            const read = selectedCallableRead(origin, frontier.bindings, "value");
            candidatePhysical = read.kind === "selected" ? read.carrier
              : read.kind === "not-read" ? adaptedPhysical(origin, frontier.bindings, current, depth) : undefined;
            if (candidatePhysical === undefined) return undefined;
          } else {
            const candidate = inputs.get(origin);
            if (candidate !== undefined) joinable = false;
            const concreteStorage = origin.kind === "input" || origin.kind === "member"
              ? input.native.isConcreteCallableStorage(origin) : false;
            if (concreteStorage === undefined)
              return fail("Native callable storage requires its exact precomputed storage classification.");
            if (origin.kind === "member" && concreteStorage) {
              const declared = input.records.runtimeCarrier.get(origin.node)?.carrier;
              const contract = declared === undefined ? undefined : callableValueCarrier(declared);
              const member = contract === undefined || !rustTargetTypeRefEquals(contract, current)
                ? undefined : rustCallablePhysicalCarrier(contract);
              if (contract === undefined || member === undefined)
                return fail("Native callable member storage requires its exact declared physical contract.");
              joinable = false;
              if (physical !== undefined && !rustTargetTypeRefEquals(physical, member))
                return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
              if (contract.kind === "target-named" && contract.id === rustCallableTargetId) erasedPhysicals.add(member);
              physical = member;
              alternatives.set(origin, member);
              continue;
            }
            const concreteParameter = origin.kind === "input" && concreteStorage
              ? logicalCarrierFor(origin, frontier.bindings) : undefined;
            const contract = candidate?.carrier ?? concreteParameter;
            const contractValue = contract === undefined ? undefined : callableValueCarrier(contract);
            const adapted = adaptedReferences.get(origin.node);
            if (adapted !== undefined && contractValue !== undefined &&
              !rustCallableInvocationSignaturesMatch(current, contractValue)) {
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
            } else if (candidate !== undefined) candidatePhysical = formalCarrier(candidate, current, frontier.bindings, depth);
            else {
              const originCarrier = origin.kind === "input" ? logicalCarrierFor(origin, frontier.bindings) : origin.projection.length === 0
                ? input.records.receiverIndependentMethod.get(origin.node)?.carrier ?? input.records.runtimeCarrier.get(origin.node)?.carrier
                : frameFieldCarrier(origin);
              // A callable parameter of an owner emitted as a closure value is a concrete runtime callable supplied by
              // the caller; its physical carrier is its declared parameter carrier, with no producer of its own.
              if (concreteParameter !== undefined) {
                const declared = concreteInput(origin, frontier.bindings);
                if (declared === undefined) return undefined;
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
              const originOwner = sourceEnclosingCallable(input.ast.parent(origin.node), input.ast);
              const generics = genericsFor(originOwner, frontier.bindings, depth + 1);
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
              if (candidatePhysical !== undefined && rustTargetGenericReferences(candidatePhysical).typeIdentities.some(identity =>
                input.native.inputs.some(selected => selected.implementation.identity === identity) &&
                !availableNativeInputs.some(selected => selected.implementation.identity === identity))) {
                const activations = generics.sourceActivations;
                if (activations.kind === "unresolved") return fail(activations.reason);
                let completed: TargetTypeRef | undefined;
                for (const row of activations.rows) {
                  if (!step(depth)) return undefined;
                  if (originOwner === undefined || row.activation.kind !== "invocation")
                    return fail("A returned native callable requires its exact selected invocation and original input bindings.");
                  const selected = prepared.completeNativeOrigin(row.activation.invocation, originOwner, candidatePhysical,
                    { storageBindings: row.activation.bindings, genericBindings: row.targetBindings });
                  if (selected === undefined)
                    return fail("A returned native callable requires its completed physical input and native error correspondence.");
                  if (completed !== undefined && !rustTargetTypeRefEquals(completed, selected))
                    return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
                  completed = selected;
                }
                if (completed === undefined)
                  return fail("A returned native callable requires its original checked source activation.");
                candidatePhysical = completed;
              }
            }
            if (candidatePhysical === undefined)
              return fail("Native callable storage has a producer without a sealed physical implementation.");
          }
          alternatives.set(origin, candidatePhysical);
          if (physical === undefined || rustTargetTypeRefEquals(physical, candidatePhysical)) physical = candidatePhysical;
          else distinct = true;
        }
        if (physical === undefined && absent.size !== 0)
          return rustCallablePhysicalCarrier(current) ?? fail("Absent callable storage requires its exact declared physical contract.");
        if (!distinct) return physical === undefined ? fail("Native callable storage has no selected physical input implementation.")
          : current.kind === "target-named" && current.id === rustCallableTargetId && joinable &&
            selectedSubject.projection.some(component => component.kind === "array-element")
            ? joinProducers(selectedSubject, bindings, position, alternatives, absent) : physical;
        // Inputs and conversion boundaries keep one physical implementation: no signature-based choice among them.
        return joinable ? joinProducers(selectedSubject, bindings, position, alternatives, absent)
          : fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
      }
      if (rustGenericCallableValue(current) !== undefined) {
        const origins = input.storage.boundValueFrontierFor(selectedSubject, bindings, [], position);
        if (origins.kind === "unresolved") return fail(origins.reason);
        const materialized = (origin: SourceStorageSubject): boolean => origin.kind !== "return" || origin.projection.length !== 0 ||
          !isRustNeverCarrier(input.records.sourceCallableReturn.get(origin.node)?.returnCarrier);
        const values = origins.frontier.filter(origin => materialized(origin.subject));
        const storedMethodValue = (origin: SourceStorageSubject): boolean =>
          origin.kind === "input" && origin.projection[origin.projection.length - 1]?.kind === "method-value";
        // Generic methods read from inputs are those inputs' stored generic callable family values.
        if (values.length !== 0 && values.every(origin => storedMethodValue(origin.subject))) return current;
        if (values.every(origin => !inputs.has(origin.subject))) {
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
        for (const { subject: origin, bindings: originBindings } of values) {
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
            candidatePhysical = formalCarrier(candidate, current, originBindings, depth);
            if (candidatePhysical === undefined) return undefined;
          }
          if (physical !== undefined && !rustTargetTypeRefEquals(physical, candidatePhysical))
            return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
          physical = candidatePhysical;
        }
        return physical ?? fail("Native callable storage has no selected physical input implementation.");
      }
      if (current.kind === "array" || current.kind === "slice") {
        const demand = requiresPhysicalSelection(current.element, depth + 1);
        if (demand === undefined) return undefined;
        if (!demand) return current;
        const component = project(selectedSubject, { kind: "array-element" });
        const element = component === undefined ? undefined : visit(current.element, component, bindings, depth + 1, false, position);
        return element === undefined ? undefined : element === current.element ? current : Object.freeze({ ...current, element });
      }
      const jsElement = rustJsArrayLikeElementTargetType(current);
      if (jsElement !== undefined && current.kind === "target-named") {
        return selectRustNativeArrayStorage(current, jsElement, selectedSubject, bindings, depth,
          { project, requiresPhysicalSelection,
            visit: (carrier, subject, bindings, depth) => visit(carrier, subject, bindings, depth, false, position) });
      }
      const storedSlots = selectRustJsStoredTypeArgumentSlots(current);
      if (storedSlots !== undefined && current.kind === "target-named") {
        return selectRustNativeCollectionStorage(input, current, storedSlots, selectedSubject, bindings, depth,
          { step, fail, requiresPhysicalSelection,
            visit: (carrier, subject, bindings, depth) => visit(carrier, subject, bindings, depth, false, position) });
      }
      if (current.kind === "tuple") {
        const demands = current.elements.map(element => requiresPhysicalSelection(element, depth + 1));
        if (demands.some(demand => demand === undefined)) return undefined;
        const elements: TargetTypeRef[] = [];
        for (const [index, element] of current.elements.entries()) {
          if (!demands[index]) {
            elements.push(element);
            continue;
          }
          const component = project(selectedSubject, { kind: "tuple-element", index });
          const selected = component === undefined ? undefined : visit(element, component, bindings, depth + 1, false, position);
          if (selected === undefined) return undefined;
          elements.push(selected);
        }
        return elements.every((element, index) => element === current.elements[index]) ? current
          : Object.freeze({ ...current, elements: Object.freeze(elements) });
      }
      const structural = rustStructuralObjectCarrierValue(current);
      if (current.kind === "target-specific" && current.target === "rust" && current.name === rustStructuralObjectCarrierName) {
        if (structural === undefined) return fail("A structural value requires its actual checked physical layout owner.");
        const completed = input.structuralShapes.definitionForCarrier(current);
        if (completed === undefined) return fail("A structural value requires its actual checked physical layout owner.");
        const demand = requiresPhysicalSelection(current, depth + 1);
        if (demand === undefined) return undefined;
        if (!demand) return completed.carrier;
        const operation = selectedSubject.kind === "value" && selectedSubject.projection.length === 0
          ? input.records.targetOperation.get(selectedSubject.node) : undefined;
        if (operation?.kind === "source-call") {
          const produced = producerResult(selectedSubject, bindings, current, depth + 1);
          if (produced === undefined) return fail("A structural call result requires its actual native producer and bound physical environment.");
          const admitted = input.structuralShapes.definitionForCarrier(produced);
          if (admitted === undefined || !rustTargetTypeRefEquals(admitted.carrier, produced))
            return fail("A structural call result requires its exact admitted native implementation template.");
          return admitted.carrier;
        }
        if (selectedSubject.kind === "return" || selectedSubject.kind === "value") {
          const origins = input.storage.boundValueFrontierFor(selectedSubject, bindings, [], position);
          if (origins.kind === "unresolved") return fail(origins.reason);
          if (origins.frontier.length !== 0 && origins.frontier.every(origin => origin.subject.kind === "input")) {
            let physical: TargetTypeRef | undefined;
            for (const origin of origins.frontier) {
              const source = logicalCarrierFor(origin.subject, origin.bindings);
              if (source === undefined || rustStructuralObjectCarrierValue(source) === undefined)
                return fail("A structural input transport requires its original checked native layout.");
              const candidate = visit(source, origin.subject, origin.bindings, depth + 1, false, position);
              if (candidate === undefined) return undefined;
              if (physical !== undefined && !rustTargetTypeRefEquals(physical, candidate))
                return fail("A structural input transport requires one exact physical storage across its original inputs.");
              physical = candidate;
            }
            return physical;
          }
        }
        if (structural.implementation === undefined && structural.fields.some((field, index) =>
          field.method === true && input.structuralShapes.field(current, index)?.methodPlan?.kind === "fixed")) {
          const origins = input.storage.boundValueFrontierFor(selectedSubject, bindings, [], position);
          if (origins.kind === "unresolved") return fail(origins.reason);
          let physical: TargetTypeRef | undefined;
          for (const origin of origins.frontier) {
            if (!step(depth)) return undefined;
            const source = logicalCarrierFor(origin.subject, origin.bindings);
            const operation = origin.subject.kind === "value" && origin.subject.projection.length === 0
              ? input.records.targetOperation.get(origin.subject.node) : undefined;
            if (source === undefined || origin.subject === selectedSubject && origin.bindings === bindings ||
              rustStructuralObjectCarrierValue(source)?.implementation === undefined && operation?.kind !== "source-call")
              return fail("A fixed structural contract requires its actual checked native body and complete state producer.");
            const candidate = visit(source, origin.subject, origin.bindings, depth + 1, false, position);
            if (candidate === undefined) return undefined;
            if (physical !== undefined && !rustTargetTypeRefEquals(physical, candidate))
              return fail("A fixed structural contract requires one exact native state and capture environment.");
            physical = candidate;
          }
          return physical ?? fail("A fixed structural contract has no actual native state producer.");
        }
        const methods: NonNullable<typeof structural.implementation>["methods"][number][] = [];
        for (const field of structural.fields) {
          if (field.method !== true) continue;
          const selected = completed.fields.find(candidate => candidate.sourceName === field.sourceName)?.methodPlan;
          if (selected === undefined) return fail("A structural method requires its exact checked physical layout owner.");
          if (selected?.kind !== "fixed") {
            const body = structural.implementation?.methods.find(method => method.sourceName === field.sourceName);
            if (body !== undefined) methods.push(Object.freeze({ sourceName: field.sourceName, identity: body.identity,
              genericArguments: Object.freeze([]) }));
            continue;
          }
          const identity = sourceNodeIdentity(input.ast, selected.declaration);
          const captures = input.capturesFor(selected.declaration);
          if (identity === undefined || captures.kind === "unresolved")
            return fail(captures.kind === "unresolved" ? captures.reason : "A fixed structural method requires its exact checked implementation identity.");
          const generic = genericsFor(sourceEnclosingCallable(input.ast.parent(selected.declaration), input.ast), bindings, depth + 1);
          if (generic.kind === "unresolved") return fail(generic.reason);
          const types = new Map(generic.bindings.types);
          for (const formal of captures.inputs) {
            const logical = substituteRustTargetGenerics(formal.carrier, types, generic.bindings.lifetimes, generic.bindings.consts);
            const physical = visit(logical, formal.subject, bindings, depth + 1, false, "input");
            const leaf = callableValueCarrier(logical);
            const actual = physical === undefined || leaf === undefined ? undefined
              : rustPhysicalPayloadFor(logical, physical, leaf, input.definitions);
            if (actual === undefined) return fail("A fixed structural context requires its actual bound native capture input.");
            types.set(formal.implementation.identity, actual);
          }
          for (const selectedInput of captures.inputs) selectedInputs.add(selectedInput);
          methods.push(Object.freeze({ sourceName: field.sourceName, identity,
            genericArguments: Object.freeze(rustTypeGenericArguments([...captures.captures, ...captures.receiverFields, ...captures.receivers]
              .map(carrier => substituteRustTargetGenerics(carrier, types, generic.bindings.lifetimes, generic.bindings.consts)))) }));
        }
        const selectedType = input.storage.typeFor(selectedSubject);
        if (selectedType.kind === "unresolved") return fail(selectedType.reason);
        const fieldSemantics = input.storage.source.semantics.forFile(selectedType.sourceFile);
        const presentType = fieldSemantics.types.nonNullableType(selectedType.type);
        if (presentType === undefined) return fail("Structural physical fields require their exact checked present source type.");
        const correspondence = fieldSemantics.types.structuralMembers(presentType, presentType, "correspondence");
        if (correspondence.kind !== "available")
          return fail("Structural physical fields require their original checked member correspondence.");
        const inputFields: Extract<RustStructuralPhysicalCompletionEvidence, { readonly kind: "native-input" }>["fields"][number][] = [];
        const fields = structural.fields.map(field => {
          if (field.method === true || field.accessor !== undefined) return field;
          const requiresImplementation = requiresPhysicalSelection(field.type, depth + 1);
          if (requiresImplementation === undefined) return undefined;
          if (requiresImplementation === false) return field;
          const member = correspondence.members.find(member => member.kind === "present" &&
            member.source.property.name === field.sourceName);
          const declarations = member?.kind === "present" ? member.source.declarations : [];
          let physical: TargetTypeRef | undefined;
          for (const declaration of declarations) {
            const component = project(selectedSubject, { kind: "member", declaration });
            const type = component === undefined ? undefined : visit(field.type, component, bindings, depth + 1, false, position);
            if (component === undefined || type === undefined) return undefined;
            if (physical !== undefined && !rustTargetTypeRefEquals(physical, type)) {
              fail("A structural field requires one exact physical storage across its checked declarations.");
              return undefined;
            }
            physical = type;
            const physicalInputs = new Set(rustTargetGenericReferences(type).typeIdentities);
            const nativeInputs = [...selectedInputs].filter(candidate => {
              if (component.kind !== "input" || candidate.subject.kind !== "input" ||
                candidate.subject.node !== component.node || !physicalInputs.has(candidate.implementation.identity)) return false;
              const prefix = input.storage.subject(candidate.subject.node, "input",
                candidate.subject.projection.slice(0, component.projection.length));
              return prefix.kind === "resolved" && prefix.subject === component;
            });
            if (nativeInputs.length !== 0) {
              if (member?.kind !== "present" || member.source.property.name !== field.sourceName ||
                !member.source.declarations.includes(declaration)) {
                fail("A structural input requires its original checked field-to-declaration correspondence.");
                return undefined;
              }
              inputFields.push(Object.freeze({ sourceName: field.sourceName, member: member.source,
                subject: component, carrier: type, inputs: Object.freeze(nativeInputs) }));
            }
          }
          return physical === undefined ? undefined : Object.freeze({ ...field, type: physical });
        });
        if (fields.some(field => field === undefined)) return undefined;
        const physical = rustStructuralObjectTargetType(structural.ownerFileName, fields as typeof structural.fields,
          structural.representation, structural.construction, structural.bases,
          methods.length === 0 ? undefined : { kind: "physical", methods: Object.freeze(methods) });
        if (rustTargetTypeRefEquals(current, physical)) return current;
        const completion = input.structuralShapes.completePhysicalCarrier(current, physical, inputFields.length === 0
          ? { kind: "instance" } : { kind: "native-input", owner: inputFields[0]!.inputs[0]!.owner,
            subject: selectedSubject, fields: Object.freeze(inputFields) });
        return completion.kind === "resolved" ? completion.carrier : fail(completion.reason);
      }
      const nominal = rustSourceTypeCarrierValue(current);
      const definition = nominal === undefined ? undefined : input.projectTypes.definitionForCarrier(current);
      if (definition !== undefined) {
        const demanded = requiresPhysicalSelection(current, depth + 1);
        if (demanded === undefined) return undefined;
        if (!demanded) return current;
        const layout = input.projectTypes.objectLayoutForDefinition(definition);
        if (layout === undefined) return fail("Native nominal data storage requires its exact original layout owner.");
        const parameters = { typeIdentities: new Set(definition.genericParameters.flatMap(parameter =>
          parameter.kind === "type" ? [parameter.identity] : [])),
          lifetimeIdentities: new Set(definition.genericParameters.flatMap(parameter =>
            parameter.kind === "lifetime" ? [rustLifetimeKey(parameter.lifetime)] : [])), constIdentities: new Set<string>() };
        const original = input.projectTypes.openCarrier(definition);
        const actual = inferRustTargetGenericBindings(original, current, parameters);
        if (actual === undefined) return fail("Native nominal data storage requires its exact original generic application.");
        const physicalTypes = new Map<string, TargetTypeRef>();
        const physicalLifetimes = new Map<string, RustLifetimeRef>();
        for (const field of layout.fields) {
          const declared = input.records.runtimeCarrier.get(field.declaration)?.carrier;
          const logical = declared === undefined ? undefined : input.projectTypes.instantiateMemberCarrier(field.declaration, current, declared);
          if (logical === undefined || declared === undefined)
            return fail("Native nominal data storage requires its checked instantiated field carrier.");
          const needed = requiresPhysicalSelection(logical, depth + 1);
          if (needed === undefined) return undefined;
          if (!needed) continue;
          const component = project(selectedSubject, { kind: "member", declaration: field.declaration });
          const physical = component === undefined ? undefined : visit(logical, component, bindings, depth + 1, false, position);
          if (physical === undefined) return undefined;
          if (!rustTargetGenericReferences(declared).typeIdentities.some(identity => parameters.typeIdentities.has(identity))) continue;
          const selected = inferRustTargetGenericBindings(declared, physical, parameters);
          if (selected === undefined) return fail("Native nominal data storage requires its exact field-to-generic physical correspondence.");
          for (const [identity, carrier] of selected.types) {
            const previous = physicalTypes.get(identity);
            if (previous !== undefined && !rustTargetTypeRefEquals(previous, carrier))
              return fail("A native nominal generic slot requires one exact physical carrier across all of its fields.");
            physicalTypes.set(identity, carrier);
          }
          for (const [identity, lifetime] of selected.lifetimes) {
            const previous = physicalLifetimes.get(identity);
            if (previous !== undefined && !rustLifetimesEqual(previous, lifetime))
              return fail("A native nominal lifetime slot requires one exact lifetime across all of its fields.");
            physicalLifetimes.set(identity, lifetime);
          }
        }
        const types = new Map(actual.types);
        for (const [identity, carrier] of physicalTypes) types.set(identity, carrier);
        const lifetimes = new Map(actual.lifetimes);
        for (const [identity, lifetime] of physicalLifetimes) lifetimes.set(identity, lifetime);
        return substituteRustTargetGenerics(original, types, lifetimes, actual.consts);
      }
      const variants = rustUnionAlternatives(current, input.definitions);
      if (variants !== undefined) {
        const demands = variants.map(variant => requiresPhysicalSelection(variant.carrier, depth + 1));
        if (demands.some(demand => demand === undefined)) return undefined;
        const payloads = variants.map((variant, index) => demands[index]
          ? visit(variant.carrier, selectedSubject, bindings, depth + 1, permitsAbsence, position) : variant.carrier);
        if (payloads.some(payload => payload === undefined)) return undefined;
        if (payloads.every((payload, index) => payload === variants[index]!.carrier)) return current;
        const selected = rustSourceUnionCarrierValue(current) === undefined
          ? instantiateRustRuntimeUnionPayloads(current, payloads as TargetTypeRef[])
          : instantiateRustSourceUnionPayloads(current, payloads as TargetTypeRef[], input.definitions);
        return selected ?? fail("Native physical union storage requires its exact canonical payload template.");
      }
      const nested = requiresPhysicalSelection(current, depth + 1);
      return nested === undefined ? undefined : nested
        ? fail("Native callable storage requires its existing physical aggregate layout owner.") : current;
    };
    if (request.kind === "invocation")
      return boundInvocation(request.declaration, subject.node, bindings, 0)
        ?? unresolved(reason ?? "Native invocation binding has no complete original physical inputs.");
    const physical = visit(request.carrier, subject, bindings, 0, false, position);
    return selectionFor(physical, request.carrier);
  }
  return Object.freeze({
    select: (subject: SourceStorageSubject, carrier: TargetTypeRef, bindings: SourceStorageBindings | undefined,
      scope: Node | undefined, position: "value" | "input" = "value"): RustNativeStorageSelection =>
      evaluate({ kind: "value", subject, carrier, bindings, scope, position }),
    boundInvocationFor: (declaration: Node, invocation: Node, callerBindings: SourceStorageBindings): RustNativeInvocationBindingsSelection => {
      const selected = input.storage.subject(invocation, "value");
      return selected.kind === "unresolved" ? selected : evaluate({ kind: "invocation", declaration,
        subject: selected.subject, bindings: callerBindings, scope: ownerFor(invocation) });
    },
  });
}

import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageBindingsSelection, SourceStorageQueries, SourceStorageSubject, SourceStorageSubjectsSelection, SourceStorageProducersSelection } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { instantiateRustSourceUnionPayloads } from "../../target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustCallableInvocationSignaturesMatch } from "../../target-model/conversions/callable-input.js";
import { rustCallableConversionPhysical } from "../../target-model/conversions/callable-physical.js";
import { substituteRustCallableConversion } from "../../target-model/conversions/substitution.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustSourceOptionalTargetType } from "../../target-model/types/projections.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";
import { isRustNativeFutureCarrier } from "../../target-model/types/carriers/primitives.js";
import { rustUnionAlternatives } from "../../target-model/types/union-relations.js";
import { rustSourceUnionCarrierValue, rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { instantiateRustRuntimeUnionPayloads } from "../../target-model/types/carriers/runtime-unions.js";
import { rustTargetGenericBindingsForArguments } from "../../target-model/types/generic-arguments.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustPhysicalPayloadFor } from "../../target-model/types/physical-payloads.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";
import { rustNativeCallablePhysicalSource, rustNativeCallableInputPhysicalSignature } from "../../policy/conversions/native-callables.js";
import { rustNativeCallableAbsenceWitness } from "../../policy/conversions/native-callables.js";
import { asSourceNode } from "@tsonic/target-api/source";
import { isRustNeverCarrier } from "../../target-model/types/carriers/js.js";
import { createRustEffectsWorkBudget } from "../errors/effects-work-budget.js";

import type { RustSourceCallableSpecializationIssue } from "../../target-model/records/callable-issues.js";
import { rustNativeCallableInvocationArguments } from "../../policy/operations/callables/native-invocations.js";
import { createRustNativeStorageGenericSelection, selectRustNativeStorageGenericBindings,
  rustNativeStorageProjectionSteps, rustNativeStorageProjectionDepth, type RustNativeStorageGenericSelection } from "./native-storage-generics.js";
import { createRustNativeFutureInputPlan, type RustNativeFutureEnvironmentSelection } from "./native-future-inputs.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustNativeCallableInput } from "../../target-model/records/native-protocols.js";
import type { RustNativeCallableProducerPlan } from "../../target-model/records/native-producers.js";
import type { RustGenericCallablePlan } from "./generic-values.js";
import type { RustGenericCallablePhysicalCarrierSelector } from "./generic-physical.js";
import type { RustLexicalFunctionEnvironments } from "./lexical-functions.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustSourceCallCallableStorageCarrier } from "../operations/target-operation.js";
import type { RustStructuralStorageLookup } from "../operations/target-operation.js";
import { rustSourceStorageProjectedCarrier, type RustValueDomainCarrierHost } from "../../policy/types/objects/value-domain-carrier.js";
import { selectRustSourceCallableInvocationBindings } from "./native-storage-generics.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustPhysicalCallableSourceSelection } from "../../target-model/records/physical-emission-contexts.js";

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
}): RustNativeStorageQueries {
  const nodes = new Set(input.storage.nodes);
  const inputs = new Map(input.native.inputs.map(value => [value.subject, value]));
  const ownedInputs = new Set(input.native.inputs);
  const absenceWitnesses = new Map<Node, Map<RustNativeCallableInput, TargetTypeRef>>();
  const argumentWitnesses = new Map<Node, Map<Node, TargetTypeRef>>();
  const conversionBoundaries: SourceStorageSubject[] = [];
  let boundaryFailure: string | undefined;
  for (const node of input.nativeNodes) {
    if (input.records.contextualValueConversion.get(node)?.conversion.kind !== "callable-adapter") continue;
    const selected = input.storage.subject(node, "value");
    if (selected.kind === "unresolved") boundaryFailure ??= selected.reason;
    else conversionBoundaries.push(selected.subject);
  }
  const boundaries = Object.freeze(conversionBoundaries);
  const unresolved = (reason: string): Extract<RustNativeStorageSelection, { readonly kind: "unresolved" }> =>
    Object.freeze({ kind: "unresolved", reason });
  const returns = new Map<Node, RustNativeStorageSelection>();
  const unpreparedReturn = unresolved("Native callable return requires its prepared physical source selection.");
  const bindingsFor = (owner: Node | undefined): SourceStorageBindings | undefined => owner === undefined
    ? input.storage.emptyBindings : nodes.has(owner) ? input.native.bindingsFor(owner) : undefined;
  const ownerFor = (node: Node): Node | undefined => sourceEnclosingCallable(node, input.ast);
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
    input.native.callFor(invocation) !== undefined ? undefined : selectRustSourceCallableInvocationBindings(input,
      declaration, invocation, bindings, arguments_, caller);
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
    const sources: RustPhysicalCallableSourceSelection[] = [];
    const fail = (message: string): undefined => { reason ??= message; return undefined; };
    const step = (depth: number): boolean => {
      if (remaining-- > 0 && depth <= rustNativeStorageProjectionDepth) return true;
      fail("Native callable storage exceeds its bounded carrier projection budget.");
      return false;
    };
    const genericsFor = createRustNativeStorageGenericSelection({ ...input, step, genericInvocationBindingsFor });
    const containsCallable = (type: TargetTypeRef, depth: number, visited = new Set<TargetTypeRef>()): boolean | undefined => {
      if (!step(depth)) return undefined;
      if (visited.has(type)) return false;
      visited.add(type);
      if (rustCallableProtocol(type) !== undefined || rustGenericCallableValue(type) !== undefined || isRustNativeFutureCarrier(type)) return true;
      const variants = input.definitions.sourceUnionVariants(type);
      const shape = rustStructuralObjectCarrierValue(type);
      const children: TargetTypeRef[] = [];
      if (shape !== undefined) {
        for (const [index, sourceField] of shape.fields.entries()) {
          const field = input.structuralShapes.field(type, index);
          if (field === undefined) {
            fail("Native aggregate storage requires its exact structural field layout owner.");
            return undefined;
          }
          if (sourceField.method === true) {
            if (field.method !== true || field.methodStorageCarrier === undefined) {
              fail("Native aggregate method storage requires its canonical callable field layout owner.");
              return undefined;
            }
          } else if (field.storage === "stored" && field.nativeMethod !== true) children.push(sourceField.type);
        }
      } else if (type.kind !== "function-pointer") children.push(...rustTargetTypeChildren(type));
      for (const child of [...children, ...(variants?.map(variant => variant.carrier) ?? [])]) {
        const selected = containsCallable(child, depth + 1, visited);
        if (selected !== false) return selected;
      }
      return false;
    };
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
        for (const origin of origins.frontier) {
          if (!step(depth)) return undefined;
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
        return physical ?? fail("Native Future storage has no exact physical input implementation.");
      }
      if (rustCallableProtocol(current) !== undefined) {
        if (boundaryFailure !== undefined) return fail(boundaryFailure);
        const selected = input.storage.boundValueFrontierFor(selectedSubject, bindings, boundaries, position);
        if (selected.kind === "unresolved") return fail(selected.reason);
        let physical: TargetTypeRef | undefined;
        for (const frontier of selected.frontier) {
          if (!step(depth)) return undefined;
          const origin = frontier.subject;
          let candidatePhysical: TargetTypeRef | undefined;
          if (frontier.kind === "boundary") {
            const fact = input.records.contextualValueConversion.get(origin.node);
            if (origin.projection.length !== 0 || fact?.conversion.kind !== "callable-adapter" ||
              !rustTargetTypeRefEquals(fact.sourceCarrier, rustValueCarrierBeforeContextualConversion(input.records, origin.node)))
              return fail("Native callable conversion storage requires its exact finalized source and destination contract.");
            const generics = genericsFor(ownerFor(origin.node), frontier.bindings, depth + 1);
            if (generics.kind === "unresolved") return fail(generics.reason);
            const { types, lifetimes, consts } = generics.bindings;
            const conversion = substituteRustCallableConversion(fact.conversion, types, lifetimes, consts);
            const target = callableValueCarrier(conversion.target);
            if (target === undefined || !rustCallableInvocationSignaturesMatch(current, target))
              return fail("Native callable conversion storage conflicts with its selected activation signature.");
            const operand = visit(conversion.source, origin, frontier.bindings, depth + 1, false, "input");
            const physicalInputs = operand === undefined ? [] : [...selectedInputs].filter(candidate =>
              rustTargetTypeRefEquals(candidate.implementation, operand));
            const sourceCarrier = physicalInputs.length === 0 ? conversion.source : physicalInputs.length === 1 &&
              rustCallableInvocationSignaturesMatch(conversion.source, physicalInputs[0]!.carrier)
              ? physicalInputs[0]!.carrier : undefined;
            const source = operand === undefined || sourceCarrier === undefined ? undefined : rustNativeCallablePhysicalSource(sourceCarrier,
              { kind: "selected", carrier: operand, inputs: [...selectedInputs] });
            const file = input.ast.getSourceFile(origin.node);
            candidatePhysical = source === undefined || file === undefined ? undefined
              : rustCallableConversionPhysical(conversion, source.signature, input.ast.getFileName(file), input.definitions)?.carrier;
            if (candidatePhysical === undefined)
              return fail("Native callable conversion storage has no exact physical adaptation contract.");
          } else {
            const candidate = inputs.get(origin);
            if (candidate !== undefined) candidatePhysical = formalCarrier(candidate, current);
            else {
              const originCarrier = origin.projection.length === 0
                ? input.records.receiverIndependentMethod.get(origin.node)?.carrier ?? input.records.runtimeCarrier.get(origin.node)?.carrier
                : undefined;
              if (permitsAbsence && isRustAbsenceCarrier(originCarrier)) continue;
              const generics = genericsFor(sourceEnclosingCallable(input.ast.parent(origin.node), input.ast), frontier.bindings, depth + 1);
              if (generics.kind === "unresolved") return fail(generics.reason);
              const { types, lifetimes, consts } = generics.bindings;
              const boundCarrier = originCarrier === undefined ? undefined
                : callableValueCarrier(substituteRustTargetGenerics(originCarrier, types, lifetimes, consts));
              const produced = originCarrier === undefined || boundCarrier === undefined || !rustCallableInvocationSignaturesMatch(current, boundCarrier)
                ? undefined : rustFrameCallableValue(originCarrier) !== undefined
                  ? originCarrier : input.producers.physicalFor(origin.node, originCarrier);
              candidatePhysical = produced === undefined ? undefined : substituteRustTargetGenerics(produced, types, lifetimes, consts);
            }
            if (candidatePhysical === undefined)
              return fail("Native callable storage has a producer without a sealed physical implementation.");
          }
          if (physical !== undefined && !rustTargetTypeRefEquals(physical, candidatePhysical))
            return fail("Native callable storage has distinct physical input alternatives requiring a sealed join.");
          physical = candidatePhysical;
        }
        return physical ?? fail("Native callable storage has no selected physical input implementation.");
      }
      if (rustGenericCallableValue(current) !== undefined) {
        const origins = input.storage.boundOriginsFor(selectedSubject, bindings);
        if (origins.kind === "unresolved") return fail(origins.reason);
        const materialized = (origin: SourceStorageSubject): boolean => origin.kind !== "return" || origin.projection.length !== 0 ||
          !isRustNeverCarrier(input.records.sourceCallableReturn.get(origin.node)?.returnCarrier);
        const values = origins.subjects.filter(materialized);
        if (values.every(origin => !inputs.has(origin))) {
          const producers = input.storage.storageProducersFor(selectedSubject, bindings);
          if (producers.kind !== "complete") return fail(producers.kind === "unresolved" ? producers.reason
            : "A generic callable physical environment requires its exact closed source producers.");
          const present = producers.producers.filter(producer => materialized(producer.subject) &&
            (!permitsAbsence || producer.subject.projection.length !== 0 ||
              !isRustAbsenceCarrier(input.records.runtimeCarrier.get(producer.subject.node)?.carrier)));
          const ownerFileName = input.ast.getFileName(input.ast.getSourceFile(selectedSubject.node));
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
          if (candidate === undefined) {
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
        : Object.freeze({ kind: "selected", carrier: physical, inputs: Object.freeze([...selectedInputs]), sources: selectedSources });
  };
  const selectReturn = (declaration: Node): RustNativeStorageSelection => {
    const result = input.records.sourceCallableReturn.get(declaration);
    const parameter = result?.borrowedParameter;
    if (parameter !== undefined) {
      const abi = input.records.sourceParameterAbi.get(parameter);
      if (input.ast.parent(parameter) !== declaration || !input.ast.parameters(declaration).includes(parameter) ||
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
  const witnessBudget = createRustEffectsWorkBudget();
  let witnessSubject: Node | undefined;
  const witnessFailure = witnessBudget.run(() => { for (const invocation of input.storage.invocations) {
    witnessSubject = invocation;
    witnessBudget.step();
    const operation = input.records.targetOperation.get(invocation);
    const signature = input.records.selectedCall.get(invocation);
    const declaration = asSourceNode(signature?.sourceDeclaration, input.ast);
    if (operation?.kind !== "source-call" || signature === undefined || declaration === undefined) continue;
    for (const selected of input.native.inputsFor(declaration)) {
      witnessBudget.step();
      if (rustOptionElementCarrier(selected.carrier) === undefined) continue;
      const bindings = invocationBindingsFor(selected.owner, invocation);
      const origins = bindings.kind === "unresolved" ? bindings : input.storage.boundOriginsFor(selected.subject, bindings.bindings);
      if (origins.kind !== "resolved" || origins.subjects.length === 0 || origins.subjects.some(subject => subject.projection.length !== 0 ||
        !isRustAbsenceCarrier(input.records.runtimeCarrier.get(subject.node)?.carrier) &&
        !(subject.kind === "return" && isRustNeverCarrier(input.records.sourceCallableReturn.get(subject.node)?.returnCarrier)))) continue;
      const prototype = rustNativeCallableAbsenceWitness(selected, input.definitions);
      const generics = rustTargetGenericBindingsForArguments(signature.member.genericParameters ?? [], operation.targetGenericArguments ?? []);
      if (prototype === undefined || generics === undefined) continue;
      const witness = snapshotClosedMetadata(substituteRustTargetGenerics(prototype, generics.types, generics.lifetimes, generics.consts));
      witnessBudget.metadata(witness);
      const witnesses = absenceWitnesses.get(invocation) ?? new Map<RustNativeCallableInput, TargetTypeRef>();
      witnesses.set(selected, witness);
      absenceWitnesses.set(invocation, witnesses);
      if (selected.subject.projection.length === 0) {
        const index = input.ast.parameters(selected.owner).indexOf(selected.subject.node);
        for (const supplied of operation.parameters[index]?.inputs ?? []) {
          witnessBudget.step();
          if (supplied.sourceForm !== "value") continue;
          const argument = input.ast.arguments(invocation)[supplied.sourceArgumentIndex];
          if (argument === undefined) continue;
          const arguments_ = argumentWitnesses.get(invocation) ?? new Map<Node, TargetTypeRef>();
          arguments_.set(argument, snapshotClosedMetadata(rustSourceOptionalTargetType(witness)));
          argumentWitnesses.set(invocation, arguments_);
        }
      }
    }
  } });
  return Object.freeze({
    logicalCarrierFor,
    issues: Object.freeze(witnessFailure === undefined || witnessSubject === undefined ? [] : [{
      subject: witnessSubject, message: witnessFailure.message,
    }]),
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
      return subject.kind === "unresolved" ? subject : select(subject.subject, carrier, bindingsFor(ownerFor(node)));
    },
    operandFor(node: Node): RustNativeStorageSelection {
      if (!nodes.has(node)) return unresolved("Native callable operand requires an owned source node.");
      const carrier = rustValueCarrierBeforeContextualConversion(input.records, node);
      if (carrier === undefined) return unresolved("Native callable operand has no finalized logical carrier.");
      const subject = input.storage.subjectFor(node);
      return subject.kind === "unresolved" ? subject
        : select(subject.subject, carrier, bindingsFor(ownerFor(node)), "input");
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

function callableValueCarrier(carrier: TargetTypeRef): TargetTypeRef | undefined {
  let current = carrier;
  for (let depth = 0; depth <= 128; depth += 1) {
    const optional = rustOptionElementCarrier(current);
    if (optional !== undefined) current = optional;
    else if (current.kind === "reference") current = current.referent;
    else return current;
  }
  return undefined;
}

import type { RustNativeStorageSelection } from "../../target-model/records/native-storage.js";

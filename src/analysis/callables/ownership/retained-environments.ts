import type { Node } from "@tsonic/tsts";
import type { SourceOwnershipUnresolved, SourceStorageBindings, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity, sourceCallableValueParameters, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../../program/walk.js";

import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustRetainedEnvironment } from "./retained-values.js";
import { rustHasOpenOwnedStorage } from "../../../policy/ownership/retained-storage.js";
import { selectRustSuspendedStorageLifetime } from "../../../policy/ownership/suspended-storage.js";
import { rustEnclosingStorageContract } from "../storage/storage-contracts.js";
import { rustCallScopedElisionLifetime, rustLifetimeKey, rustStaticLifetime, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { substituteRustTargetGenerics, substituteRustTargetGenericArgument } from "../../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { rustSourceStorageProjectedCarrier } from "../../objects/value-domain-carriers.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustRetainedCallSubstitutions } from "./retained-call-lifetimes.js";
import type { RustNativeStoragePlan } from "../storage/native-storage.js";
import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native/native-producers.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustSourceCallableSpecializationPlan } from "../generics/specializations.js";
import type { createRustCallableEntryHeaderPlacements } from "../emission/entry-header-placements.js";
import { rustTargetGenericTypeArguments } from "../../../target-model/types/generic-arguments.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

export function selectRustNativePendingEnvironment(input: {
  readonly source: TargetSourceProgram;
  readonly storage: Pick<SourceStorageQueries, "subject" | "subjectFor">;
  readonly records: RustProgramRecords;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "boundInvocationFor" | "genericBindingsFor">;
  readonly producers: Pick<RustNativeCallableProducerPlan, "bodyResultFor">;
  readonly specializations: RustSourceCallableSpecializationPlan;
  readonly headers: Pick<ReturnType<typeof createRustCallableEntryHeaderPlacements>, "nativeBody"> | SourceOwnershipUnresolved;
  readonly step: () => boolean;
  readonly retainDataFor: (subject: SourceStorageSubject, bindings: SourceStorageBindings,
    carrier: TargetTypeRef) => TargetTypeRef | SourceOwnershipUnresolved;
}, subject: SourceStorageSubject, bindings: SourceStorageBindings,
carrier: TargetTypeRef): TargetTypeRef | SourceOwnershipUnresolved | undefined {
  if (subject.kind !== "value" || subject.projection.length !== 0) return undefined;
  const operation = input.records.targetOperation.get(subject.node);
  if (operation?.kind !== "source-call" || operation.asyncBody === undefined) return undefined;
  const unresolved = (reason: string): SourceOwnershipUnresolved => Object.freeze({ kind: "unresolved", at: subject.node, reason });
  if (!input.step()) return unresolved("Native pending storage exceeds its shared retained-data work budget.");
  if ("kind" in input.headers) return input.headers;
  const declaration = operation.asyncBody.declaration;
  const bound = input.nativeStorage.boundInvocationFor(declaration, subject.node, bindings);
  if (bound.kind === "unresolved") return unresolved(bound.reason);
  const produced = input.producers.bodyResultFor(declaration);
  if (produced === undefined) return unresolved("Native pending storage requires its original completed body result.");
  const actual = substituteRustTargetGenerics(produced, bound.targetBindings.types,
    bound.targetBindings.lifetimes, bound.targetBindings.consts);
  if (!rustTargetTypeRefEquals(actual, carrier))
    return unresolved("Native pending storage requires its identical bound physical body result.");
  const caller = sourceEnclosingCallable(subject.node, input.source.ast);
  const callerBindings = caller === undefined ? { kind: "resolved" as const,
    bindings: { types: new Map(), lifetimes: new Map(), consts: new Map() } }
    : input.nativeStorage.genericBindingsFor(caller, bindings);
  if (callerBindings.kind === "unresolved") return unresolved(callerBindings.reason);
  const arguments_ = rustTargetGenericTypeArguments(operation.targetGenericArguments ?? []).map(argument =>
    substituteRustTargetGenerics(argument, callerBindings.bindings.types, callerBindings.bindings.lifetimes, callerBindings.bindings.consts));
  const variant = input.specializations.requiresSpecialization(declaration)
    ? input.specializations.variantForCall(declaration, arguments_) : undefined;
  const selected = input.headers.nativeBody(declaration, variant, input.step);
  if (selected.kind === "unresolved") return selected;
  const selectedCarrier = (carrier: TargetTypeRef): TargetTypeRef => substituteRustTargetGenerics(
    substituteRustTargetGenerics(carrier, selected.header.bindings.types,
      selected.header.bindings.lifetimes, selected.header.bindings.consts), bound.targetBindings.types,
    bound.targetBindings.lifetimes, bound.targetBindings.consts);
  const obligations: TargetTypeRef[] = [];
  const retain = (subject: SourceStorageSubject, carrier: TargetTypeRef): SourceOwnershipUnresolved | undefined => {
    const value = input.retainDataFor(subject, bound.storageBindings, carrier);
    if (value.kind === "unresolved") return value;
    obligations.push(value);
    return undefined;
  };
  for (const slot of selected.entry.slots) {
    if (!input.step()) return unresolved("Native pending storage exceeds its shared retained-data work budget.");
    const physical = selectedCarrier(slot.carrier);
    if (slot.kind === "method-receiver" || slot.kind === "structural-receiver" && slot.passing === "shared" ||
      slot.kind === "class-environment")
      return unresolved("Native pending receiver storage requires its exact selected source borrow-duration proof.");
    if (slot.kind === "task") { obligations.push(physical); continue; }
    const storage = input.storage;
    if (slot.kind === "source" || slot.kind === "structural-receiver") {
      const source = storage.subject(slot.kind === "source" ? slot.declaration : declaration,
        slot.kind === "source" ? "input" : "receiver");
      if (source.kind === "unresolved") return unresolved(source.reason);
      const failure = retain(source.subject, physical);
      if (failure !== undefined) return failure;
    } else {
      const reads = slot.kind === "lexical" ? [slot.capture.reference] : slot.parameter.reads;
      if (reads.length === 0) return unresolved("Native pending storage requires its original checked incoming source references.");
      for (const read of reads) {
        const source = storage.subjectFor(read);
        if (source.kind === "unresolved") return unresolved(source.reason);
        const failure = retain(source.subject, physical);
        if (failure !== undefined) return failure;
      }
    }
  }
  for (const capture of selected.header.captureArguments) {
    if (!input.step()) return unresolved("Native pending storage exceeds its shared retained-data work budget.");
    const selectedCapture = substituteRustTargetGenericArgument(substituteRustTargetGenericArgument(capture,
      selected.header.bindings.types, selected.header.bindings.lifetimes, selected.header.bindings.consts),
    bound.targetBindings.types, bound.targetBindings.lifetimes, bound.targetBindings.consts);
    if (selectedCapture.kind === "type") obligations.push(selectedCapture.type);
    else if (selectedCapture.kind === "lifetime") obligations.push(Object.freeze({ kind: "reference", mutable: false,
      referent: Object.freeze({ kind: "tuple", elements: Object.freeze([]) }), lifetime: selectedCapture.lifetime }));
  }
  return Object.freeze({ kind: "tuple", elements: Object.freeze(obligations) });
}

export function rustRetainedCallLifetimes(
  walk: RustFactWalk, invocation: Node, declaration: Node, parameters: readonly TargetTypeRef[], result: TargetTypeRef,
): ReadonlyMap<string, RustLifetimeRef> | undefined {
  const { ast, records, sourceStorage: storage } = walk.context;
  const references = rustTargetGenericReferences({ kind: "tuple", elements: [...parameters, result] });
  if (references.lifetimes.length === 0) return new Map();
  const selected = rustRetainedEnvironment(declaration, parameters, walk.context);
  if (selected.kind === "unresolved") return undefined;
  if (selected.kind === "none") {
    // The callee's signature names its own retained environment (selected for its open generic inputs), but at this
    // instantiation no input is open storage, so the result retains only storage it owns: 'static.
    const declared = walk.context.retainedEnvironments.environmentFor(declaration);
    return declared.kind === "selected" && references.lifetimeIdentities.includes(rustLifetimeKey(declared.environment.lifetime))
      ? new Map([[rustLifetimeKey(declared.environment.lifetime), rustStaticLifetime]]) : new Map();
  }
  const environment = selected.environment;
  if (!references.lifetimeIdentities.includes(rustLifetimeKey(environment.lifetime))) return new Map();
  const caller = sourceEnclosingCallable(invocation, ast);
  const callerBindings = storage.bindingsForLexicalOwner(invocation);
  if (callerBindings.kind !== "resolved") return undefined;
  const activation = storage.bindingsForInvocation(declaration, invocation, callerBindings.bindings);
  if (activation.kind !== "resolved") return undefined;
  const callerParameters = caller === undefined ? [] : sourceCallableValueParameters(ast, caller, walk.context.semanticsFor(caller));
  if (callerParameters === undefined) return undefined;
  const callerEnvironment = caller === undefined ? { kind: "none" as const }
    : rustRetainedEnvironment(caller, callerParameters.map(parameter =>
      records.sourceParameterAbi.get(parameter)?.parameterCarrier), walk.context);
  if (callerEnvironment.kind === "unresolved") return undefined;
  const knownCaller = caller === undefined ? undefined : records.retainedEnvironment.get(caller);
  const retainedCaller = knownCaller ?? (callerEnvironment.kind === "selected" ? callerEnvironment.environment : undefined);
  const carriers: TargetTypeRef[] = [];
  const scopeLifetimes: RustLifetimeRef[] = [];
  const projected = new Map<SourceStorageSubject, Map<SourceStorageBindings, TargetTypeRef | undefined>>();
  const lexicalVisits = new Set<Node>();
  const carrierFor = (subject: SourceStorageSubject, bindings: SourceStorageBindings | undefined): TargetTypeRef | undefined => {
    const operation = records.targetOperation.get(subject.node);
    if (subject.kind === "value" && subject.projection.length === 0 &&
      (operation?.kind === "array-literal" || operation?.kind === "tuple-literal")) {
      const values = operation.kind === "array-literal"
        ? operation.contributions.flatMap(contribution => contribution.kind === "value" ? [contribution.carrier]
          : contribution.input.inputs.flatMap(input => input.kind === "empty" ? [] : [input.presentCarrier]))
        : ast.elements(subject.node).map(element => element === undefined ? undefined : records.runtimeCarrier.get(element)?.carrier);
      if (!values.every((carrier): carrier is TargetTypeRef => carrier !== undefined)) return undefined;
      const lifetime = walk.operationOptions.callableValueLifetime(subject.node, values, "construction");
      return lifetime === undefined ? undefined : reference(lifetime);
    }
    if (subject.kind === "value" && subject.projection.length === 0 &&
      records.targetOperation.get(subject.node)?.kind === "closure") {
      const captures = records.closureCapture.get(subject.node);
      if (captures === undefined) return undefined;
      const carriers = [...captures.captures, ...captures.receiverFields, ...captures.receivers].map(capture => capture.carrier);
      const lifetime = walk.operationOptions.callableValueLifetime(subject.node, carriers, "construction");
      return lifetime === undefined ? undefined : reference(lifetime);
    }
    if (subject.kind === "value" && subject.projection.length === 0 && ast.body(subject.node) !== undefined) {
      // A lexical function bound as a value retains what it captures, as the environment selection reads it
      // (retained-environment-shapes.ts): its lifetime comes from the carriers of its captured sources.
      if (lexicalVisits.has(subject.node)) return reference(rustCallScopedElisionLifetime(
        sourceNodeIdentity(ast, subject.node) ?? "lexical-function", "owned-environment"));
      const lexical = walk.context.retainedEnvironments.lexicalFor(subject.node);
      if (lexical.kind === "unresolved") return undefined;
      lexicalVisits.add(subject.node);
      const captured: TargetTypeRef[] = [];
      for (const capture of lexical.captures) {
        const source = storage.subjectFor(capture.references[0]!);
        const carrier = source.kind === "resolved" ? carrierFor(source.subject, bindings) : undefined;
        if (carrier === undefined) return undefined;
        captured.push(carrier);
      }
      lexicalVisits.delete(subject.node);
      const lifetime = walk.operationOptions.callableValueLifetime(subject.node, captured, "construction");
      return lifetime === undefined ? undefined : reference(lifetime);
    }
    const root = subject.kind === "input"
      ? records.sourceParameterAbi.get(subject.node)?.parameterCarrier
      : records.runtimeCarrier.get(subject.node)?.carrier;
    if (subject.projection.length === 0) return root;
    if (bindings === undefined) return undefined;
    const previous = projected.get(subject);
    if (previous?.has(bindings)) return previous.get(bindings);
    const carrier = rustSourceStorageProjectedCarrier({ sourceStorage: storage, sourceTypes: walk.sourceTypes,
      projectFieldProjection: walk.operationOptions.projectFieldProjection, semantics: walk.context.semantics,
      types: { resolveNode: node => records.runtimeCarrier.get(node)?.carrier },
    }, { subject, bindings }, root);
    const entries = previous ?? new Map<SourceStorageBindings, TargetTypeRef | undefined>();
    entries.set(bindings, carrier);
    projected.set(subject, entries);
    return carrier;
  };
  const reference = (lifetime: RustLifetimeRef): TargetTypeRef => ({ kind: "reference", mutable: false,
    referent: { kind: "tuple", elements: [] }, lifetime });
  // An origin inside another callee's body carries that callee's own retained lifetimes; each invocation the origin
  // was produced through substitutes them with its recorded call-site lifetimes, out to this call's caller.
  const throughCalls = (origin: SourceStorageSubject, bindings: SourceStorageBindings | undefined,
    carrier: TargetTypeRef): TargetTypeRef | undefined => {
    if (bindings === undefined) return carrier;
    let selected = carrier;
    let owner = sourceEnclosingCallable(origin.kind === "value" && ast.body(origin.node) !== undefined
      ? ast.parent(origin.node) : origin.node, ast);
    let current = bindings;
    for (let depth = 0; owner !== undefined && owner !== caller; depth += 1) {
      if (depth > 64) return undefined;
      const activations = storage.boundActivationsFor(owner, current);
      if (activations.kind !== "resolved") return undefined;
      const invocations = activations.activations.filter(entry => entry.kind === "invocation");
      if (invocations.length !== 1) return selected;
      const entry = invocations[0]!;
      if (entry.kind !== "invocation") return selected;
      const lifetimes = rustRetainedCallSubstitutions(records, entry.invocation);
      if (lifetimes.size !== 0) selected = substituteRustTargetGenerics(selected, new Map(), lifetimes);
      owner = sourceEnclosingCallable(entry.invocation, ast);
      current = entry.callerBindings;
    }
    return selected;
  };
  for (const retained of environment.inputs) {
    if (retained.kind === "native-task-scope") {
      if (callerEnvironment.kind === "selected" &&
        callerEnvironment.environment.inputs.some(input => input.kind === "native-task-scope"))
        scopeLifetimes.push(callerEnvironment.environment.lifetime);
      else {
        const identity = sourceNodeIdentity(ast, invocation);
        if (identity === undefined) return undefined;
        scopeLifetimes.push(rustCallScopedElisionLifetime(identity, environment.lifetime.identity));
      }
      continue;
    }
    const parameter = retained.declaration;
    const subject = storage.subject(parameter, "input");
    if (subject.kind !== "resolved") return undefined;
    const sources = storage.boundValueFrontierFor(subject.subject, activation.bindings, []);
    if (sources.kind !== "resolved" || sources.frontier.length === 0) return undefined;
    for (const { subject: source, bindings: sourceBindings } of sources.frontier) {
      const node = source.node;
      const unsubstituted = carrierFor(source, sourceBindings);
      const carrier = unsubstituted === undefined ? undefined : throughCalls(source, sourceBindings, unsubstituted);
      if (carrier === undefined) return undefined;
      const lifetime = rustCallableProtocol(carrier)?.lifetime;
      if (lifetime !== undefined && lifetime.kind !== "placeholder") {
        carriers.push(reference(lifetime));
        continue;
      }
      if (source.kind === "input") {
        if (rustHasOpenOwnedStorage(carrier)) {
          const identity = sourceNodeIdentity(ast, invocation);
          if (identity === undefined) return undefined;
          carriers.push(reference(retainedCaller?.inputs.some(input => input.kind === "parameter" && input.declaration === node) === true ? retainedCaller.lifetime
            : rustCallScopedElisionLifetime(identity, environment.lifetime.identity)));
        } else carriers.push(carrier);
        continue;
      }
      if (source.kind !== "value") return undefined;
      carriers.push(carrier);
    }
  }
  const contract = rustEnclosingStorageContract(invocation, ast, walk.context.sourceLifetimes);
  const retainedLifetimes = new Set((retainedCaller?.inputs ?? []).flatMap(input => {
    if (input.kind === "native-task-scope") return retainedCaller === undefined ? [] : [rustLifetimeKey(retainedCaller.lifetime)];
    const carrier = records.sourceParameterAbi.get(input.declaration)?.parameterCarrier;
    return carrier === undefined || rustHasOpenOwnedStorage(carrier) ? [] : rustTargetGenericReferences(carrier).lifetimeIdentities;
  }));
  const effective = retainedCaller === undefined ? contract : { ...contract, parameters: [
    ...contract.parameters.map(parameter => parameter.kind !== "lifetime" || !retainedLifetimes.has(rustLifetimeKey(parameter.lifetime)) ? parameter
      : { ...parameter, outlives: [...parameter.outlives, retainedCaller.lifetime] }),
    { kind: "lifetime" as const, declaration: caller!, sourceName: retainedCaller.lifetime.name,
      lifetime: retainedCaller.lifetime, outlives: [] },
  ] };
  const lifetime = selectRustSuspendedStorageLifetime({ carriers, lifetimes: scopeLifetimes }, effective);
  if (lifetime === undefined) {
    if (scopeLifetimes.some(lifetime => lifetime.kind !== "call-scoped-elision")) return undefined;
    const elisions = [...carriers.flatMap(carrier => rustTargetGenericReferences(carrier).callScopedElisions),
      ...scopeLifetimes.filter(lifetime => lifetime.kind === "call-scoped-elision")];
    if (elisions.length === 0 || !elisions.every(lifetime => rustLifetimeKey(lifetime) === rustLifetimeKey(elisions[0]!)) ||
      carriers.some(carrier => rustTargetGenericReferences(carrier).lifetimes.length !== 0)) return undefined;
    return new Map([[rustLifetimeKey(environment.lifetime), elisions[0]!]]);
  }
  return new Map([[rustLifetimeKey(environment.lifetime), lifetime]]);
}

export function rustRetainedCallResult(result: TargetTypeRef, lifetimes: ReadonlyMap<string, RustLifetimeRef>): TargetTypeRef {
  return substituteRustTargetGenerics(result, new Map(), lifetimes);
}

import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity, sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustRetainedEnvironment } from "./retained-values.js";
import { rustHasOpenOwnedStorage } from "../../policy/ownership/retained-storage.js";
import { selectRustSuspendedStorageLifetime } from "../../policy/ownership/suspended-storage.js";
import { rustEnclosingStorageContract } from "./storage-contracts.js";
import { rustCallScopedElisionLifetime, rustLifetimeKey, rustStaticLifetime, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustSourceStorageProjectedCarrier } from "../objects/value-domain-carriers.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustRetainedCallSubstitutions } from "./retained-call-lifetimes.js";

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
    const sources = storage.boundOriginsFor(subject.subject, activation.bindings);
    if (sources.kind !== "resolved" || sources.subjects.length === 0) return undefined;
    const producers = storage.storageProducersFor(subject.subject, activation.bindings);
    if (producers.kind === "unresolved") return undefined;
    const producerBindings = new Map(producers.producers.map(producer => [producer.subject, producer.bindings] as const));
    for (const source of sources.subjects) {
      const node = source.node;
      const unsubstituted = carrierFor(source, producerBindings.get(source));
      const carrier = unsubstituted === undefined ? undefined : throughCalls(source, producerBindings.get(source), unsubstituted);
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

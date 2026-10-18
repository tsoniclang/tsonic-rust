import type { Node } from "@tsonic/tsts";
import type { SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";

import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustHasOpenOwnedStorage, rustRetainedEnvironment, rustRetainedValueLifetime } from "../../policy/ownership/retained-environments.js";
import { rustEnclosingStorageContract, selectRustSuspendedStorageLifetime } from "../../policy/ownership/suspended-storage.js";
import { rustCallScopedElisionLifetime, rustLifetimeKey, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustSourceStorageProjectedCarrier } from "../../policy/types/objects/value-domain-carrier.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";

export type RustRetainedCallLifetimeSelection =
  | { readonly kind: "resolved"; readonly lifetimes: ReadonlyMap<string, RustLifetimeRef> }
  | { readonly kind: "unresolved"; readonly reason: string };

export function rustRetainedCallLifetimes(
  walk: RustFactWalk, invocation: Node, declaration: Node, parameters: readonly TargetTypeRef[], result: TargetTypeRef,
): RustRetainedCallLifetimeSelection {
  const { ast, records, sourceStorage: storage } = walk.context;
  const resolved = (lifetimes: ReadonlyMap<string, RustLifetimeRef>): RustRetainedCallLifetimeSelection =>
    ({ kind: "resolved", lifetimes });
  const unresolved = (reason: string): RustRetainedCallLifetimeSelection => ({ kind: "unresolved", reason });
  const references = rustTargetGenericReferences({ kind: "tuple", elements: [...parameters, result] });
  if (references.lifetimes.length === 0) return resolved(new Map());
  const selected = rustRetainedEnvironment(declaration, parameters, walk.context);
  if (selected.kind === "unresolved") return selected;
  if (selected.kind === "none") return resolved(new Map());
  const environment = selected.environment;
  if (!references.lifetimeIdentities.includes(rustLifetimeKey(environment.lifetime))) return resolved(new Map());
  const caller = sourceEnclosingCallable(invocation, ast);
  const callerBindings = storage.bindingsForLexicalOwner(invocation);
  if (callerBindings.kind !== "resolved") return callerBindings;
  const activation = storage.bindingsForInvocation(declaration, invocation, callerBindings.bindings);
  if (activation.kind !== "resolved") return activation;
  const callerEnvironment = caller === undefined ? { kind: "none" as const }
    : rustRetainedEnvironment(caller, ast.parameters(caller).map(parameter =>
      records.sourceParameterAbi.get(parameter)?.parameterCarrier), walk.context);
  if (callerEnvironment.kind === "unresolved") return callerEnvironment;
  const knownCaller = caller === undefined ? undefined : records.retainedEnvironment.get(caller);
  const retainedCaller = knownCaller ?? (callerEnvironment.kind === "selected" ? callerEnvironment.environment : undefined);
  const carriers: TargetTypeRef[] = [];
  const projected = new Map<SourceStorageSubject, TargetTypeRef | undefined>();
  const carrierFor = (subject: SourceStorageSubject): TargetTypeRef | undefined => {
    if (subject.kind === "value" && subject.projection.length === 0 &&
      records.targetOperation.get(subject.node)?.kind === "closure") {
      const captures = records.closureCapture.get(subject.node);
      if (captures === undefined) return undefined;
      const carriers = [...captures.captures, ...captures.receiverFields, ...captures.receivers].map(capture => capture.carrier);
      const lifetime = rustRetainedValueLifetime(subject.node, carriers, walk);
      return lifetime === undefined ? undefined : reference(lifetime);
    }
    const root = subject.kind === "input"
      ? records.sourceParameterAbi.get(subject.node)?.parameterCarrier
      : subject.kind === "return" ? records.sourceCallableReturn.get(subject.node)?.returnCarrier
      : records.runtimeCarrier.get(subject.node)?.carrier;
    if (subject.projection.length === 0) return root;
    if (projected.has(subject)) return projected.get(subject);
    const carrier = rustSourceStorageProjectedCarrier({ sourceStorage: storage, sourceTypes: walk.sourceTypes,
      projectFieldProjection: walk.operationOptions.projectFieldProjection, semantics: walk.context.semantics,
      types: { resolveNode: node => records.runtimeCarrier.get(node)?.carrier },
    }, subject, root);
    projected.set(subject, carrier);
    return carrier;
  };
  const reference = (lifetime: RustLifetimeRef): TargetTypeRef => ({ kind: "reference", mutable: false,
    referent: { kind: "tuple", elements: [] }, lifetime });
  for (const parameter of environment.parameters) {
    const subject = storage.subject(parameter, "input");
    if (subject.kind !== "resolved") return subject;
    const sources = storage.boundOriginsFor(subject.subject, activation.bindings);
    if (sources.kind !== "resolved") return sources;
    if (sources.subjects.length === 0) return unresolved(
      "The retained native parameter has no original source input in its selected invocation activation.");
    for (const source of sources.subjects) {
      const node = source.node;
      const carrier = carrierFor(source);
      if (carrier === undefined) return unresolved(
        `The retained native environment has no exact ${source.kind} carrier for its original activated source projection.`);
      const lifetime = rustCallableProtocol(carrier)?.lifetime;
      if (lifetime !== undefined && lifetime.kind !== "placeholder") {
        carriers.push(reference(lifetime));
        continue;
      }
      if (source.kind === "input") {
        if (rustHasOpenOwnedStorage(carrier)) {
          const identity = sourceNodeIdentity(ast, invocation);
          if (identity === undefined) return unresolved("The retained native call has no original checked invocation identity.");
          carriers.push(reference(retainedCaller?.parameters.includes(node) === true ? retainedCaller.lifetime
            : rustCallScopedElisionLifetime(identity, environment.lifetime.identity)));
        } else carriers.push(carrier);
        continue;
      }
      if (source.kind !== "value" && source.kind !== "return") return unresolved(
        "The retained native input requires its actual value, formal or returned source correspondence.");
      if (source.kind === "return" && rustHasOpenOwnedStorage(carrier)) return unresolved(
        "The retained native return source has no closed original callable or native storage lifetime.");
      carriers.push(carrier);
    }
  }
  const contract = rustEnclosingStorageContract(invocation, ast, walk.context.sourceLifetimes);
  const retainedLifetimes = new Set((retainedCaller?.parameters ?? []).flatMap(parameter => {
    const carrier = records.sourceParameterAbi.get(parameter)?.parameterCarrier;
    return carrier === undefined || rustHasOpenOwnedStorage(carrier) ? [] : rustTargetGenericReferences(carrier).lifetimeIdentities;
  }));
  const effective = retainedCaller === undefined ? contract : { ...contract, parameters: [
    ...contract.parameters.map(parameter => parameter.kind !== "lifetime" || !retainedLifetimes.has(rustLifetimeKey(parameter.lifetime)) ? parameter
      : { ...parameter, outlives: [...parameter.outlives, retainedCaller.lifetime] }),
    { kind: "lifetime" as const, declaration: caller!, sourceName: retainedCaller.lifetime.name,
      lifetime: retainedCaller.lifetime, outlives: [] },
  ] };
  const lifetime = selectRustSuspendedStorageLifetime(carriers, effective);
  if (lifetime === undefined) {
    const elisions = carriers.flatMap(carrier => rustTargetGenericReferences(carrier).callScopedElisions);
    if (elisions.length === 0 || !elisions.every(lifetime => rustLifetimeKey(lifetime) === rustLifetimeKey(elisions[0]!)) ||
      carriers.some(carrier => rustTargetGenericReferences(carrier).lifetimes.length !== 0)) return unresolved(
        "The activated retained native sources have no single exact lifetime satisfying their original enclosing outlives contract.");
    return resolved(new Map([[rustLifetimeKey(environment.lifetime), elisions[0]!]]));
  }
  return resolved(new Map([[rustLifetimeKey(environment.lifetime), lifetime]]));
}

export function rustRetainedCallResult(result: TargetTypeRef, lifetimes: ReadonlyMap<string, RustLifetimeRef>): TargetTypeRef {
  return substituteRustTargetGenerics(result, new Map(), lifetimes);
}

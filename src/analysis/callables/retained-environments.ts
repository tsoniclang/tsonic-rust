import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable, sourceLexicalEnvironment, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { rustSourceParameterAbiFactKey } from "../facts/keys.js";
import { rustRetainedEnvironmentFactKey } from "../facts/retained-environments.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustHasOpenOwnedStorage, rustRetainedEnvironment } from "../../policy/ownership/retained-environments.js";
import { rustEnclosingStorageContract, selectRustSuspendedStorageLifetime } from "../../policy/ownership/suspended-storage.js";
import { rustCallScopedElisionLifetime, rustLifetimeKey, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";

export function rustRetainedCallLifetimes(
  walk: RustFactWalk, invocation: Node, declaration: Node, parameters: readonly TargetTypeRef[], result: TargetTypeRef,
): ReadonlyMap<string, RustLifetimeRef> | undefined {
  const { ast, facts, sourceStorage: storage } = walk.context;
  const references = rustTargetGenericReferences(result);
  if (references.lifetimes.length === 0) return new Map();
  const selected = rustRetainedEnvironment(declaration, parameters, walk.context);
  if (selected.kind === "unresolved") return undefined;
  if (selected.kind === "none") return new Map();
  const environment = selected.environment;
  if (!references.lifetimeIdentities.includes(rustLifetimeKey(environment.lifetime))) return new Map();
  const caller = sourceEnclosingCallable(invocation, ast);
  const callerBindings = caller === undefined ? { kind: "resolved" as const, bindings: storage.emptyBindings }
    : storage.bindingsForDeclaration(caller);
  if (callerBindings.kind !== "resolved") return undefined;
  const activation = storage.bindingsForInvocation(declaration, invocation, callerBindings.bindings);
  if (activation.kind !== "resolved") return undefined;
  const callerEnvironment = caller === undefined ? { kind: "none" as const }
    : rustRetainedEnvironment(caller, ast.parameters(caller).map(parameter =>
      facts.get(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier), walk.context);
  if (callerEnvironment.kind === "unresolved") return undefined;
  const knownCaller = caller === undefined ? undefined : facts.get(caller, rustRetainedEnvironmentFactKey);
  const retainedCaller = knownCaller ?? (callerEnvironment.kind === "selected" ? callerEnvironment.environment : undefined);
  const carriers: TargetTypeRef[] = [];
  const active = new Map<Node, Set<SourceStorageBindings>>();
  const reference = (lifetime: RustLifetimeRef): TargetTypeRef => ({ kind: "reference", mutable: false,
    referent: { kind: "tuple", elements: [] }, lifetime });
  const retain = (subject: SourceStorageSubject, bindings: SourceStorageBindings): boolean => {
    const sources = storage.boundOriginsFor(subject, bindings);
    if (sources.kind !== "resolved") return false;
    for (const source of sources.subjects) {
      if (source.projection.length !== 0) return false;
      const node = source.node;
      if (source.kind === "input") {
        const carrier = facts.get(node, rustSourceParameterAbiFactKey)?.parameterCarrier;
        if (carrier === undefined) return false;
        if (rustHasOpenOwnedStorage(carrier)) {
          const identity = sourceNodeIdentity(ast, invocation);
          if (identity === undefined) return false;
          carriers.push(reference(retainedCaller?.parameters.includes(node) === true ? retainedCaller.lifetime
            : rustCallScopedElisionLifetime(identity, environment.lifetime.identity)));
        } else carriers.push(carrier);
        continue;
      }
      if (source.kind !== "value") return false;
      const body = ast.body(node);
      if (body === undefined) {
        const carrier = facts.getRuntimeCarrierFact(node)?.carrier;
        if (carrier === undefined) return false;
        carriers.push(carrier);
        continue;
      }
      const visits = active.get(node) ?? new Set<SourceStorageBindings>();
      if (visits.has(bindings)) continue;
      visits.add(bindings);
      active.set(node, visits);
      const lexical = sourceLexicalEnvironment(node, [body], ast, walk.context.source.navigation);
      if (lexical.kind === "unresolved" || lexical.receivers.length !== 0) return false;
      for (const capture of lexical.captures) {
        const subject = storage.subjectFor(capture.references[0]!);
        if (subject.kind !== "resolved" || !retain(subject.subject, bindings)) return false;
      }
    }
    return true;
  };
  for (const parameter of environment.parameters) {
    const subject = storage.subject(parameter, "input");
    if (subject.kind !== "resolved" || !retain(subject.subject, activation.bindings)) return undefined;
  }
  const contract = rustEnclosingStorageContract(invocation, ast, walk.context.sourceLifetimes);
  const retainedLifetimes = new Set((retainedCaller?.parameters ?? []).flatMap(parameter => {
    const carrier = facts.get(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier;
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
      carriers.some(carrier => rustTargetGenericReferences(carrier).lifetimes.length !== 0)) return undefined;
    return new Map([[rustLifetimeKey(environment.lifetime), elisions[0]!]]);
  }
  return new Map([[rustLifetimeKey(environment.lifetime), lifetime]]);
}

export function rustRetainedCallResult(result: TargetTypeRef, lifetimes: ReadonlyMap<string, RustLifetimeRef>): TargetTypeRef {
  return substituteRustTargetGenerics(result, new Map(), lifetimes);
}

export function rustRetainedValueLifetime(
  declaration: Node, captures: readonly TargetTypeRef[], walk: RustFactWalk,
): RustLifetimeRef | undefined {
  const { context } = walk;
  if (!captures.some(rustHasOpenOwnedStorage)) return selectRustSuspendedStorageLifetime(captures,
    rustEnclosingStorageContract(declaration, context.ast, context.sourceLifetimes));
  const owner = sourceEnclosingCallable(context.ast.parent(declaration), context.ast);
  const selected = owner === undefined ? { kind: "none" as const } : rustRetainedEnvironment(owner,
    context.ast.parameters(owner).map(parameter => context.facts.get(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier), context);
  if (selected.kind === "unresolved") return undefined;
  if (selected.kind === "selected") return selected.environment.lifetime;
  const identity = sourceNodeIdentity(context.ast, declaration);
  return identity === undefined ? undefined : rustCallScopedElisionLifetime(identity, "owned-environment");
}

import type { Node, SourceFile } from "@tsonic/tsts";
import { asSourceNode, sourceCallableUsesLexicalThis } from "@tsonic/target-api/source";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { RustFactWalk } from "../program/walk.js";

import { structuralStorageKey } from "../../policy/types/objects/structural-storage.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustCopiedMethodReceiverIsPreserved } from "../../policy/ownership/copied-methods.js";

export type RustCopiedMethodDecision =
  | { readonly kind: "proven"; readonly subject: Node }
  | { readonly kind: "rejected"; readonly subject: Node; readonly reason: string };

export function selectRustCopiedMethods(
  walk: RustFactWalk, files: readonly SourceFile[], componentForFile: (fileName: string) => string,
): {
  readonly decisions: ReadonlyMap<string, RustCopiedMethodDecision>;
  readonly implementations: ReadonlyMap<string, readonly { readonly node: Node; readonly carrier: TargetTypeRef }[]>;
} {
  const demands = new Map<string, Node>();
  const implementations = new Map<string, { readonly node: Node; readonly carrier: TargetTypeRef }[]>();
  const incoming = new Map<string, Set<string>>();
  const independent = new Map<string, { readonly kind: "proven" } |
    { readonly kind: "rejected"; readonly reason: string }>();
  const originalSlots = new Map<Node, Set<string>>();
  const requests = new Map<string, { readonly subject: SourceStorageSubject; readonly bindings: SourceStorageBindings }[]>();
  const { ast, sourceStorage: storage, records } = walk.context;
  const key = (carrier: TargetTypeRef, index: number): string => `${structuralStorageKey(carrier, componentForFile)}#${index}`;
  const request = (identity: string, node: Node, subject: SourceStorageSubject): void => {
    demands.set(identity, node);
    const bindings = storage.bindingsForLexicalOwner(node);
    if (bindings.kind === "unresolved") {
      independent.set(identity, { kind: "rejected", reason: bindings.reason });
      return;
    }
    const selected = requests.get(identity) ?? [];
    selected.push({ subject, bindings: bindings.bindings });
    requests.set(identity, selected);
  };
  const requestMember = (identity: string, node: Node, receiver: Node,
    carrier: TargetTypeRef, index: number): void => {
    demands.set(identity, node);
    const subject = storage.subjectFor(receiver);
    if (subject.kind === "unresolved") {
      independent.set(identity, { kind: "rejected", reason: subject.reason });
      return;
    }
    const shape = walk.sourceTypes.structuralObjectForCarrier(carrier);
    const field = shape?.fields[index];
    if (shape === undefined || field?.method !== true || field.storageIndex !== index ||
      field.declarations.length === 0) {
      independent.set(identity, { kind: "rejected", reason: shape === undefined
        ? "The copied method receiver has no registered source shape for its exact selected carrier."
          : `The copied method receiver has no exact checked method declaration at storage index ${index}.` });
      return;
    }
    for (const declaration of field.declarations) {
      const selected = storage.subject(subject.subject.node, subject.subject.kind,
        [...subject.subject.projection, { kind: "method-value", declaration }]);
      if (selected.kind === "unresolved") independent.set(identity, { kind: "rejected", reason: selected.reason });
      else request(identity, node, selected.subject);
    }
  };
  const visit = (node: Node): void => {
    if (!walk.context.isNativeNode(node)) return;
    const binding = records.bindingProjection.get(node);
    if (binding !== undefined && "bindingCarrier" in binding && binding.projection.kind === "object-rest") {
      const shape = rustStructuralObjectCarrierValue(binding.sourceCarrier);
      for (const field of binding.projection.fields) {
        if (shape?.fields[field.sourceStorageIndex]?.method === true) {
          const target = key(binding.bindingCarrier, field.targetStorageIndex);
          requestMember(target, node, node, binding.bindingCarrier, field.targetStorageIndex);
        }
      }
    }
    const view = records.objectReferenceView.get(node);
    if (view?.kind === "structural") {
      const shape = rustStructuralObjectCarrierValue(view.targetCarrier);
      for (const field of view.fields) {
        if (shape?.fields[field.destinationIndex]?.method !== true) continue;
        const target = key(view.targetCarrier, field.destinationIndex);
        requestMember(target, node, node, view.sourceCarrier, field.source.storageIndex);
      }
    }
    const operation = records.targetOperation.get(node);
    if (operation?.kind === "source-field" && operation.storage === "structural-object" && operation.valueSemantics.kind === "method") {
      const identity = key(operation.receiverCarrier, operation.storageIndex);
      demands.set(identity, node);
      const provenance = records.selectedOperation.get(node)?.provenance;
      const receiver = asSourceNode(provenance?.sourceReceiver, ast);
      const declaration = asSourceNode(provenance?.sourceSelectedDeclaration, ast);
      const subject = receiver === undefined || declaration === undefined ? undefined
        : storage.storageSubjectFor(receiver, [{ kind: "method-value", declaration }]);
      if (subject?.kind !== "resolved") independent.set(identity, { kind: "rejected", reason: subject?.reason ??
        "The selected method read has no original checked receiver and member provenance." });
      else request(identity, node, subject.subject);
    }
    if (operation?.kind === "record-literal" && operation.storage === "structural-object") {
      const fields = new Map(operation.fields.map(field => [field.storageIndex, field]));
      for (const contribution of operation.contributions) {
        if (contribution.kind === "structural-method") {
          const field = fields.get(contribution.targetStorageIndex);
          if (field === undefined) continue;
          const identity = key(operation.resultCarrier, contribution.targetStorageIndex);
          const selected = implementations.get(identity) ?? [];
          selected.push({ node: contribution.expression, carrier: field.carrier });
          implementations.set(identity, selected);
          const slots = originalSlots.get(contribution.expression) ?? new Set<string>();
          slots.add(identity);
          originalSlots.set(contribution.expression, slots);
        } else if (contribution.kind === "spread" && contribution.sourceStorage === "structural-object") {
          for (const field of contribution.fields) {
            const identity = key(operation.resultCarrier, field.targetStorageIndex);
            if (field.method === true && !rustCopiedMethodReceiverIsPreserved(contribution.sourceValueCarrier,
              field.sourceStorageIndex, operation.resultCarrier, field.targetStorageIndex)) {
              requestMember(identity, contribution.property, contribution.expression,
                contribution.sourceValueCarrier, field.sourceStorageIndex);
            }
          }
        }
      }
    }
    walk.context.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of files) visit(file);
  const receiverUsage = new Map<Node, boolean>();
  for (const [identity, selected] of requests) {
    const sources = incoming.get(identity) ?? new Set<string>();
    incoming.set(identity, sources);
    for (const requested of selected) {
      const producers = storage.storageProducersFor(requested.subject, requested.bindings);
      if (producers.kind !== "complete") {
        independent.set(identity, { kind: "rejected", reason: producers.kind === "unresolved" ? producers.reason
          : `The original method implementation domain remains open (${[...new Set(producers.boundaries.map(boundary => boundary.kind))].join(", ")}).` });
        continue;
      }
      if (producers.producers.length === 0) {
        independent.set(identity, { kind: "rejected", reason: "The checked method producer domain contains no original callable implementation." });
        continue;
      }
      for (const producer of producers.producers) {
        const original = producer.subject;
        const slots = original.kind === "value" && original.projection.length === 0
          ? originalSlots.get(original.node) : undefined;
        if (slots === undefined || slots.size === 0) {
          independent.set(identity, { kind: "rejected", reason:
            `The checked method producer has no admitted original literal construction (${original.kind}; ${ast.kindName(original.node)}; projection depth ${original.projection.length}).` });
          continue;
        }
        for (const slot of slots) sources.add(slot);
      }
    }
  }
  const pending = [...demands.keys()];
  for (let index = 0; index < pending.length; index++) {
    const identity = pending[index]!;
    for (const source of incoming.get(identity) ?? []) {
      if (!demands.has(source)) {
        demands.set(source, demands.get(identity)!);
        pending.push(source);
      }
    }
  }
  for (const identity of demands.keys()) {
    const methods = implementations.get(identity) ?? [];
    if (methods.length === 0 || independent.get(identity)?.kind === "rejected") continue;
    const receiverIndependent = methods.every(method => {
      let used = receiverUsage.get(method.node);
      if (used === undefined) {
        used = sourceCallableUsesLexicalThis(walk.context.ast, method.node);
        receiverUsage.set(method.node, used);
      }
      return !used;
    });
    independent.set(identity, receiverIndependent ? { kind: "proven" }
      : { kind: "rejected", reason: "An original method implementation uses the original receiver." });
  }
  const proven = proveRustCopiedMethodFlow([...demands.keys()], incoming,
    new Map([...independent].map(([identity, decision]) => [identity, decision.kind === "proven"])));
  const decisions = new Map<string, RustCopiedMethodDecision>();
  for (const [identity, subject] of demands) {
    const selected = independent.get(identity);
    decisions.set(identity, proven.has(identity) ? { kind: "proven", subject }
      : { kind: "rejected", subject, reason: selected?.kind === "rejected" ? selected.reason
        : "A reaching copied-method source has no grounded receiver-independent implementation." });
  }
  return { decisions, implementations };
}

export function proveRustCopiedMethodFlow(
  identities: readonly string[],
  incoming: ReadonlyMap<string, ReadonlySet<string>>,
  implementations: ReadonlyMap<string, boolean>,
): ReadonlySet<string> {
  const selected = new Set(identities);
  const dependents = new Map<string, string[]>();
  for (const identity of identities) {
    for (const source of incoming.get(identity) ?? []) {
      const targets = dependents.get(source) ?? [];
      targets.push(identity);
      dependents.set(source, targets);
    }
  }
  const grounded = new Set(identities.filter(identity => implementations.has(identity)));
  propagate(grounded);
  const rejected = new Set(identities.filter(identity => !grounded.has(identity) ||
    implementations.get(identity) === false || [...(incoming.get(identity) ?? [])].some(source => !selected.has(source))));
  propagate(rejected);
  return new Set(identities.filter(identity => grounded.has(identity) && !rejected.has(identity)));

  function propagate(seeds: Set<string>): void {
    const pending = [...seeds];
    for (let index = 0; index < pending.length; index++) {
      for (const target of dependents.get(pending[index]!) ?? []) {
        if (!seeds.has(target)) {
          seeds.add(target);
          pending.push(target);
        }
      }
    }
  }
}

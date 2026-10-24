import type { Node, SourceFile } from "@tsonic/tsts";
import { asSourceNode, sourceCallableUsesLexicalThis } from "@tsonic/target-api/source";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { RustFactWalk } from "../program/walk.js";

import { structuralStorageKey } from "../../policy/types/objects/structural-storage.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustCopiedMethodReceiverIsPreserved } from "../../policy/ownership/copied-methods.js";
import { rustStructuralMethodProducers } from "../callables/structural-method-producers.js";

export function selectRustCopiedMethods(
  walk: RustFactWalk, files: readonly SourceFile[], componentForFile: (fileName: string) => string,
): {
  readonly proven: ReadonlySet<string>;
  readonly demands: ReadonlyMap<string, Node>;
  readonly implementations: ReadonlyMap<string, readonly { readonly node: Node; readonly carrier: TargetTypeRef }[]>;
} {
  const demands = new Map<string, Node>();
  const implementations = new Map<string, { readonly node: Node; readonly carrier: TargetTypeRef }[]>();
  const incoming = new Map<string, Set<string>>();
  const independent = new Map<string, boolean>();
  const originalSlots = new Map<Node, Set<string>>();
  const requests = new Map<string, { readonly subject: SourceStorageSubject; readonly bindings: SourceStorageBindings }[]>();
  const { ast, sourceStorage: storage, records } = walk.context;
  const key = (carrier: TargetTypeRef, index: number): string => `${structuralStorageKey(carrier, componentForFile)}#${index}`;
  const request = (identity: string, node: Node, subject: SourceStorageSubject): void => {
    demands.set(identity, node);
    const bindings = storage.bindingsForLexicalOwner(node);
    if (bindings.kind === "unresolved") {
      independent.set(identity, false);
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
    const typed = subject.kind === "unresolved" ? subject : storage.typeFor(subject.subject);
    const sourceType = typed.kind === "unresolved" ? undefined
      : storage.source.semantics.forFile(typed.sourceFile).types.nonNullableType(typed.type);
    const shape = sourceType === undefined ? undefined : walk.sourceTypes.structuralObjectForType(sourceType, carrier);
    const field = shape?.fields[index];
    if (subject.kind === "unresolved" || field?.method !== true || field.storageIndex !== index ||
      field.declarations.length === 0) {
      independent.set(identity, false);
      return;
    }
    for (const declaration of field.declarations) {
      const selected = storage.subject(subject.subject.node, subject.subject.kind,
        [...subject.subject.projection, { kind: "method-value", declaration }]);
      if (selected.kind === "unresolved") independent.set(identity, false);
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
      if (subject?.kind !== "resolved") independent.set(identity, false);
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
      const producers = rustStructuralMethodProducers(storage, requested.subject, requested.bindings, undefined);
      if (producers.kind !== "complete" || producers.producers.length === 0) {
        independent.set(identity, false);
        continue;
      }
      for (const producer of producers.producers) {
        const original = producer.subject;
        const slots = original.kind === "value" && original.projection.length === 0
          ? originalSlots.get(original.node) : undefined;
        if (slots === undefined || slots.size === 0) {
          independent.set(identity, false);
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
    if (methods.length === 0 || independent.get(identity) === false) continue;
    independent.set(identity, methods.every(method => {
      let used = receiverUsage.get(method.node);
      if (used === undefined) {
        used = sourceCallableUsesLexicalThis(walk.context.ast, method.node);
        receiverUsage.set(method.node, used);
      }
      return !used;
    }));
  }
  const proven = proveRustCopiedMethodFlow([...demands.keys()], incoming, independent);
  return { proven, demands, implementations };
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

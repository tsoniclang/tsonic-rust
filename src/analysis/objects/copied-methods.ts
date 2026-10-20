import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";

import { structuralStorageKey } from "../../policy/types/objects/structural-storage.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { rustCopiedMethodReceiverIsPreserved } from "../../policy/ownership/copied-methods.js";

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
  const key = (carrier: TargetTypeRef, index: number): string => `${structuralStorageKey(carrier, componentForFile)}#${index}`;
  const visit = (node: Node): void => {
    if (!walk.context.isNativeNode(node)) return;
    const binding = walk.context.records.bindingProjection.get(node);
    if (binding !== undefined && "bindingCarrier" in binding && binding.projection.kind === "object-rest") {
      const shape = rustStructuralObjectCarrierValue(binding.sourceCarrier);
      for (const field of binding.projection.fields) {
        if (shape?.fields[field.sourceStorageIndex]?.method === true) {
          const source = key(binding.sourceCarrier, field.sourceStorageIndex);
          const target = key(binding.bindingCarrier, field.targetStorageIndex);
          demands.set(source, node);
          demands.set(target, node);
          const sources = incoming.get(target) ?? new Set<string>();
          sources.add(source);
          incoming.set(target, sources);
        }
      }
    }
    const view = walk.context.records.objectReferenceView.get(node);
    if (view?.kind === "structural") {
      const shape = rustStructuralObjectCarrierValue(view.targetCarrier);
      for (const field of view.fields) {
        if (shape?.fields[field.destinationIndex]?.method !== true) continue;
        const target = key(view.targetCarrier, field.destinationIndex);
        const sources = incoming.get(target) ?? new Set<string>();
        sources.add(key(view.sourceCarrier, field.source.storageIndex));
        incoming.set(target, sources);
        demands.set(target, node);
      }
    }
    const operation = walk.context.records.targetOperation.get(node);
    if (operation?.kind === "source-field" && operation.storage === "structural-object" && operation.valueSemantics.kind === "method") {
      demands.set(key(operation.receiverCarrier, operation.storageIndex), node);
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
        } else if (contribution.kind === "spread" && contribution.sourceStorage === "structural-object") {
          for (const field of contribution.fields) {
            const identity = key(operation.resultCarrier, field.targetStorageIndex);
            if (field.method === true && !rustCopiedMethodReceiverIsPreserved(contribution.sourceValueCarrier,
              field.sourceStorageIndex, operation.resultCarrier, field.targetStorageIndex)) {
              demands.set(identity, contribution.property);
            }
            const sources = incoming.get(identity) ?? new Set<string>();
            sources.add(key(contribution.sourceValueCarrier, field.sourceStorageIndex));
            incoming.set(identity, sources);
          }
        }
      }
    }
    walk.context.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of files) visit(file);
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
  const receiverUsage = new Map<Node, boolean>();
  const independent = new Map<string, boolean>();
  for (const identity of demands.keys()) {
    const methods = implementations.get(identity) ?? [];
    if (methods.length === 0) continue;
    independent.set(identity, methods.every(method => {
      let used = receiverUsage.get(method.node);
      if (used === undefined) {
        used = usesReceiver(method.node);
        receiverUsage.set(method.node, used);
      }
      return !used;
    }));
  }
  const proven = proveRustCopiedMethodFlow([...demands.keys()], incoming, independent);
  return { proven, demands, implementations };

  function usesReceiver(root: Node): boolean {
    let used = false;
    const scan = (node: Node): void => {
      const kind = walk.context.ast.kindName(node);
      if (kind === "KindThisExpression" || kind === "KindThisKeyword" || kind === "KindSuperKeyword" || kind === "KindSuperExpression") {
        used = true;
        return;
      }
      if (node !== root && ["KindFunctionDeclaration", "KindFunctionExpression", "KindMethodDeclaration",
        "KindClassDeclaration", "KindClassExpression", "KindGetAccessor", "KindSetAccessor"].includes(kind)) return;
      if (!used) walk.context.ast.forEachChild(node, child => { if (child !== undefined) scan(child); });
    };
    scan(root);
    return used;
  }
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

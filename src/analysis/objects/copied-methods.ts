import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { rustBindingProjectionFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import { rustReceiverIndependentMethodFactKey } from "../facts/operations/keys.js";
import { structuralStorageKey } from "./structural-shape-plan.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustObjectReferenceViewKey } from "../facts/object-reference-views.js";

export function finalizeRustCopiedMethods(
  walk: RustFactWalk, files: readonly SourceFile[], componentForFile: (fileName: string) => string,
): ReadonlySet<string> {
  const demands = new Map<string, Node>();
  const implementations = new Map<string, { readonly node: Node; readonly carrier: TargetTypeRef }[]>();
  const incoming = new Map<string, Set<string>>();
  const key = (carrier: TargetTypeRef, index: number): string => `${structuralStorageKey(carrier, componentForFile)}#${index}`;
  const visit = (node: Node): void => {
    const binding = walk.context.facts.getFact(node, rustBindingProjectionFactKey);
    if (binding?.projection.kind === "object-rest") {
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
    const view = walk.context.facts.getFact(node, rustObjectReferenceViewKey);
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
    const operation = walk.context.facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "source-field" && operation.storage === "structural-object" && operation.valueSemantics.kind === "method") {
      demands.set(key(operation.receiverCarrier, operation.storageIndex), node);
    }
    if (operation?.kind === "record-literal" && operation.storage === "structural-object") {
      for (const contribution of operation.contributions) {
        if (contribution.kind === "structural-method") {
          const field = operation.fields.find(field => field.storageIndex === contribution.targetStorageIndex);
          if (field === undefined) continue;
          const identity = key(operation.resultCarrier, contribution.targetStorageIndex);
          const selected = implementations.get(identity) ?? [];
          selected.push({ node: contribution.expression, carrier: field.carrier });
          implementations.set(identity, selected);
        } else if (contribution.kind === "spread" && contribution.sourceStorage === "structural-object") {
          for (const field of contribution.fields) {
            const identity = key(operation.resultCarrier, field.targetStorageIndex);
            const sources = incoming.get(identity) ?? new Set<string>();
            sources.add(key(contribution.sourceCarrier, field.sourceStorageIndex));
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
  const proven = new Set<string>();
  const dependents = new Map<string, string[]>();
  const remainingSources = new Map<string, number>();
  const receiverUsage = new Map<Node, boolean>();
  const ready: string[] = [];
  for (const identity of demands.keys()) {
    const methods = implementations.get(identity) ?? [];
    const sources = incoming.get(identity);
    if (!methods.every(method => {
      let used = receiverUsage.get(method.node);
      if (used === undefined) {
        used = usesReceiver(method.node);
        receiverUsage.set(method.node, used);
      }
      return !used;
    })) continue;
    const count = sources?.size ?? 0;
    if (count === 0) {
      if (methods.length > 0) ready.push(identity);
      continue;
    }
    remainingSources.set(identity, count);
    for (const source of sources!) {
      const targets = dependents.get(source) ?? [];
      targets.push(identity);
      dependents.set(source, targets);
    }
  }
  for (let index = 0; index < ready.length; index++) {
    const identity = ready[index]!;
    proven.add(identity);
    for (const target of dependents.get(identity) ?? []) {
      const remaining = remainingSources.get(target)! - 1;
      remainingSources.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  for (const [identity, subject] of demands) {
    const methods = implementations.get(identity) ?? [];
    if (!proven.has(identity)) {
      appendRustDiagnostic(walk, "RUST_COPIED_METHOD_RECEIVER_NOT_PROVEN",
        "Object rest requires a closed own method value whose implementations do not use the original receiver.", subject,
        ["target.capability=rust.object-rest.method-value"]);
      continue;
    }
    for (const method of methods) {
      walk.context.facts.set(method.node, rustReceiverIndependentMethodFactKey, { carrier: method.carrier },
        [{ message: "rust copied method has a proven receiver-independent callable ABI" }]);
    }
  }
  return proven;

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

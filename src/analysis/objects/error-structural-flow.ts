import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustErrorStorageSubject } from "./error-storage-subjects.js";

export function createRustErrorStructuralFlow(
  source: TargetSourceProgram,
  step: () => boolean,
  subject: (node: Node | undefined, kind?: RustErrorStorageSubject["kind"]) => RustErrorStorageSubject | undefined,
  connect: (origin: RustErrorStorageSubject | undefined, destination: RustErrorStorageSubject | undefined) => void,
): (origin: RustErrorStorageSubject, destination: RustErrorStorageSubject) => void {
  const selectedTypes = new Map<RustErrorStorageSubject, Type | undefined>();
  const visited = new WeakMap<Type, WeakSet<Type>>();
  const pending: { readonly origin: RustErrorStorageSubject; readonly destination: RustErrorStorageSubject }[] = [];
  let draining = false;
  const typeFor = (value: RustErrorStorageSubject): Type | undefined => {
    if (selectedTypes.has(value)) return selectedTypes.get(value);
    const semantics = source.semantics.forNode(value.node);
    const nodeType = semantics.declarations.declaredValueType(value.node) ?? semantics.types.expressionType(value.node);
    const signatures = value.kind !== "return" || nodeType === undefined ? [] : semantics.types.callSignatures(nodeType)
      .filter(signature => semantics.declarations.signatureDeclaration(signature) === value.node);
    const selected = value.kind === "return" ? signatures.length === 1 ? semantics.types.returnType(signatures[0]!) : undefined
      : value.kind === "receiver" ? semantics.declarations.declaredType(value.node) : nodeType;
    selectedTypes.set(value, selected);
    return selected;
  };
  return (origin, destination) => {
    pending.push({ origin, destination });
    if (draining) return;
    draining = true;
    while (pending.length !== 0 && step()) {
      const selected = pending.pop()!;
      const from = typeFor(selected.origin);
      const to = typeFor(selected.destination);
      if (from === undefined || to === undefined || from === to) continue;
      const targets = visited.get(from) ?? new WeakSet<Type>();
      if (targets.has(to)) continue;
      targets.add(to);
      visited.set(from, targets);
      const relation = source.semantics.forNode(selected.origin.node).types.structuralMembers(from, to);
      if (relation.kind !== "available") continue;
      for (const member of relation.members) {
        if (!step()) break;
        if (member.kind !== "present" || member.source.read === "method" || member.destination.read === "method") continue;
        for (const original of member.source.declarations) {
          if (!step()) break;
          const from = subject(original, source.ast.is.IsGetAccessorDeclaration(original) ? "return" : "value");
          for (const target of member.destination.declarations) {
            if (!step()) break;
            connect(from, subject(target, source.ast.is.IsGetAccessorDeclaration(target) ? "return" : "value"));
          }
        }
      }
    }
    draining = false;
  };
}

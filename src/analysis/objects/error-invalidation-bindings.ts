import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustErrorStorageSubject } from "./error-storage-subjects.js";

export type RustErrorInvalidationBindings = ReadonlyMap<RustErrorStorageSubject, ReadonlySet<RustErrorStorageSubject>>;

export function createRustErrorInvalidationBindings(
  source: TargetSourceProgram,
  step: () => boolean,
  subject: (node: Node | undefined, kind?: RustErrorStorageSubject["kind"]) => RustErrorStorageSubject | undefined,
  incoming: ReadonlyMap<RustErrorStorageSubject, ReadonlySet<RustErrorStorageSubject>>,
  invocationOrigins: (origin: RustErrorStorageSubject, candidate: Node, invocation: Node) => ReadonlySet<RustErrorStorageSubject>,
) {
  const empty: RustErrorInvalidationBindings = new Map();
  const bindingSets = new Map<string, RustErrorInvalidationBindings>();
  const identities = new Map<RustErrorStorageSubject, number>();
  const identity = (subject: RustErrorStorageSubject): number => {
    let selected = identities.get(subject);
    if (selected === undefined) { selected = identities.size; identities.set(subject, selected); }
    return selected;
  };
  const origins = (origin: RustErrorStorageSubject, bindings: RustErrorInvalidationBindings): ReadonlySet<RustErrorStorageSubject> => {
    const remaining = [origin];
    const checked = new Set<RustErrorStorageSubject>();
    const origins = new Set<RustErrorStorageSubject>();
    while (remaining.length !== 0 && step()) {
      const selected = remaining.pop()!;
      if (checked.has(selected)) continue;
      checked.add(selected);
      const bound = bindings.get(selected);
      if (bound !== undefined) { for (const actual of bound) origins.add(actual); continue; }
      const parents = incoming.get(selected);
      if (parents === undefined || parents.size === 0) origins.add(selected);
      else remaining.push(...parents);
    }
    return origins;
  };
  const forInvocation = (candidate: Node, invocation: Node, parent: RustErrorInvalidationBindings): RustErrorInvalidationBindings => {
    const selected = new Map(parent);
    const parameters = source.ast.is.IsClassDeclaration(candidate) || source.ast.is.IsClassExpression(candidate)
      ? [] : source.ast.parameters(candidate);
    for (const parameter of [...parameters, candidate]) {
      if (parameter === undefined || !step()) continue;
      const formal = subject(parameter, parameter === candidate ? "receiver" : "value")!;
      const actual = new Set<RustErrorStorageSubject>();
      for (const origin of invocationOrigins(formal, candidate, invocation)) {
        for (const value of origins(origin, parent)) actual.add(value);
      }
      selected.set(formal, actual);
    }
    const key = [...selected].map(([formal, origins]) => [identity(formal),
      [...origins].map(identity).sort((left, right) => left - right)] as const)
      .sort((left, right) => left[0] - right[0]).map(([formal, origins]) => `${formal}:${origins.join(",")}`).join(";");
    const cached = bindingSets.get(key);
    if (cached !== undefined) return cached;
    bindingSets.set(key, selected);
    return selected;
  };
  return Object.freeze({ empty, origins, forInvocation });
}

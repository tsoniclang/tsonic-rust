import type { Node } from "@tsonic/tsts";
import { createSourceStorageBudget, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../program/context.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetGenericTypeArguments, substituteRustTargetTypeParameters } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

interface NativeBodyVertex {
  readonly declaration: Node;
  readonly name: string;
  readonly arguments: readonly TargetTypeRef[];
  readonly substitutions: ReadonlyMap<string, TargetTypeRef>;
  readonly edges: { readonly call: Node; readonly target: NativeBodyVertex }[];
  readonly pinned: Set<Node>;
}

export function selectRustPromiseBodyRecursion(context: RustAnalysisContext):
  | { readonly kind: "resolved"; readonly invocations: ReadonlyMap<Node, ReadonlyMap<string, ReadonlySet<Node>>> }
  | { readonly kind: "unresolved"; readonly at?: Node; readonly reason: string } {
  const budget = createSourceStorageBudget(defaultSourceStorageLimits);
  const vertices = new Map<Node, readonly NativeBodyVertex[]>();
  for (const declaration of context.sourceStorage.nodes) {
    if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
    const asynchronous = context.records.asyncFunction.get(declaration);
    const name = context.promiseBodies.nativeNameForDeclaration(declaration);
    if (asynchronous?.kind !== "js-promise" || asynchronous.lowering.kind !== "factory" || name === undefined) continue;
    const variants = context.sourceCallableSpecializations.requiresSpecialization(declaration)
      ? context.sourceCallableSpecializations.variantsForCallable(declaration).map(variant => ({
        declaration, name: variant.nativeBodyName, arguments: variant.targetTypeArguments,
        substitutions: new Map(variant.sourceTypeParameterIdentities.map((identity, index) =>
          [identity, variant.targetTypeArguments[index]!] as const)),
      })) : [{ declaration, name, arguments: [], substitutions: new Map<string, TargetTypeRef>() }];
    if (variants.some(variant => variant.name === undefined)) return { kind: "unresolved", at: declaration,
      reason: "A recursive native Promise body requires every selected specialization's physical name." };
    vertices.set(declaration, variants.map(variant => ({ ...variant, name: variant.name!, edges: [], pinned: new Set<Node>() })));
  }
  for (const call of context.sourceStorage.nodes) {
    if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
    const fact = context.records.targetOperation.get(call);
    if (fact?.kind !== "source-call" || fact.asyncBody?.maySuspend !== true) continue;
    const caller = sourceEnclosingCallable(call, context.ast);
    const callers = caller === undefined ? undefined : vertices.get(caller);
    if (callers === undefined) continue;
    const callees = vertices.get(fact.asyncBody.declaration);
    if (callees === undefined) return { kind: "unresolved", at: call,
      reason: "A selected suspending native Promise edge requires its complete physical body set." };
    for (const vertex of callers) {
      if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
      const specialized = context.sourceCallableSpecializations.requiresSpecialization(fact.asyncBody.declaration);
      const arguments_ = specialized ? rustTargetGenericTypeArguments(fact.targetGenericArguments ?? [])
        .map(argument => substituteRustTargetTypeParameters(argument, vertex.substitutions)) : [];
      const targets = callees.filter(candidate => candidate.arguments.length === arguments_.length &&
        candidate.arguments.every((argument, index) => rustTargetTypeRefEquals(argument, arguments_[index])));
      if (targets.length !== 1) return { kind: "unresolved", at: call,
        reason: "A native Promise edge requires exactly its selected physical specialization." };
      vertex.edges.push({ call, target: targets[0]! });
    }
  }
  const states = new Map<NativeBodyVertex, "active" | "closed">();
  for (const entries of vertices.values()) for (const root of entries) {
    if (states.has(root)) continue;
    const stack = [{ vertex: root, next: 0 }];
    states.set(root, "active");
    while (stack.length !== 0) {
      if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
      const current = stack[stack.length - 1]!;
      const edge = current.vertex.edges[current.next++];
      if (edge === undefined) {
        states.set(current.vertex, "closed");
        stack.pop();
      } else if (states.get(edge.target) === "active") {
        current.vertex.pinned.add(edge.call);
      } else if (!states.has(edge.target)) {
        states.set(edge.target, "active");
        stack.push({ vertex: edge.target, next: 0 });
      }
    }
  }
  return Object.freeze({ kind: "resolved", invocations: new Map([...vertices].map(([declaration, entries]) =>
    [declaration, new Map(entries.map(vertex => [vertex.name, vertex.pinned]))])) });
}

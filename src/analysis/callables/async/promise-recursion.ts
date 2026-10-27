import type { Node } from "@tsonic/tsts";
import type { SourceStorageBudget } from "@tsonic/target-api/analysis";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../../program/context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetGenericTypeArguments, substituteRustTargetTypeParameters } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

interface NativeBodyVertex {
  readonly declaration: Node;
  readonly name: string;
  readonly arguments: readonly TargetTypeRef[];
  readonly substitutions: ReadonlyMap<string, TargetTypeRef>;
  readonly edges: { readonly call: Node; readonly target: NativeBodyVertex }[];
  readonly pinned: Set<Node>;
}

export function selectRustPromiseBodyRecursion(context: RustAnalysisContext, budget: SourceStorageBudget):
  | { readonly kind: "resolved"; readonly invocations: ReadonlyMap<Node, ReadonlyMap<string, ReadonlySet<Node>>> }
  | { readonly kind: "unresolved"; readonly at?: Node; readonly reason: string } {
  const rows = budget.createRows();
  const vertices = new Map<Node, readonly NativeBodyVertex[]>();
  for (const declaration of context.nativeNodes) {
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
    for (const variant of variants) if (!budget.step() || !rows.add(4 + variant.arguments.length + variant.substitutions.size))
      return { kind: "unresolved", reason: budget.failure()! };
    if (variants.some(variant => variant.name === undefined)) failTargetAnalysisInvariant("tsonic-rust",
      "A recursive native Promise body requires every selected specialization's physical name.", declaration);
    vertices.set(declaration, variants.map(variant => ({ ...variant, name: variant.name!, edges: [], pinned: new Set<Node>() })));
  }
  for (const call of context.nativeNodes) {
    if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
    const fact = context.records.targetOperation.get(call);
    if (fact?.kind !== "source-call" || fact.asyncBody?.maySuspend !== true) continue;
    const callees = vertices.get(fact.asyncBody.declaration);
    if (callees === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A selected suspending native Promise edge requires its complete physical body set.", call);
    if (callees.length === 0) failTargetAnalysisInvariant("tsonic-rust",
      "A native Promise edge requires exactly its selected physical specialization.", call);
    const caller = sourceEnclosingCallable(call, context.ast);
    const callers = caller === undefined ? undefined : vertices.get(caller);
    if (callers === undefined) continue;
    for (const vertex of callers) {
      if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
      const specialized = context.sourceCallableSpecializations.requiresSpecialization(fact.asyncBody.declaration);
      const arguments_ = specialized ? rustTargetGenericTypeArguments(fact.targetGenericArguments ?? [])
        .map(argument => substituteRustTargetTypeParameters(argument, vertex.substitutions)) : [];
      let target: NativeBodyVertex | undefined;
      for (const candidate of callees) {
        if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
        if (candidate.arguments.length !== arguments_.length) continue;
        let matches = true;
        for (const [index, argument] of candidate.arguments.entries()) {
          if (!budget.step()) return { kind: "unresolved", reason: budget.failure()! };
          if (!rustTargetTypeRefEquals(argument, arguments_[index])) { matches = false; break; }
        }
        if (!matches) continue;
        if (target !== undefined) failTargetAnalysisInvariant("tsonic-rust",
          "A native Promise edge cannot have competing physical specializations.", call);
        target = candidate;
      }
      if (target === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "A native Promise edge requires exactly its selected physical specialization.", call);
      if (!rows.add(1)) return { kind: "unresolved", reason: budget.failure()! };
      vertex.edges.push({ call, target });
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

import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageDomainBoundary, SourceStorageProducer, SourceStorageQueries, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { Node_Expression } from "@tsonic/target-api/source";

export function rustStructuralMethodProducers(sourceStorage: SourceStorageQueries, subject: SourceStorageSubject,
  bindings: SourceStorageBindings, construction: Node | undefined):
  { readonly kind: "complete"; readonly producers: readonly SourceStorageProducer[]; readonly transported: ReadonlySet<SourceStorageProducer> } |
  { readonly kind: "open"; readonly producers: readonly SourceStorageProducer[];
    readonly boundaries: readonly SourceStorageDomainBoundary[] | undefined } |
  { readonly kind: "unresolved"; readonly reason: string } {
  if (construction !== undefined) {
    const actual = sourceStorage.subject(construction, "value");
    if (actual.kind === "unresolved") return actual;
    const typed = sourceStorage.typeFor(actual.subject);
    if (typed.kind === "unresolved") return typed;
    return { kind: "complete", producers: Object.freeze([Object.freeze({ subject: actual.subject,
      type: typed.type, sourceFile: typed.sourceFile, bindings })]), transported: new Set<SourceStorageProducer>() };
  }
  const { ast } = sourceStorage.source;
  const producers: SourceStorageProducer[] = [];
  const boundaries: SourceStorageDomainBoundary[] = [];
  const transported = new Set<SourceStorageProducer>();
  const expandedInputs = new Map<SourceStorageSubject, Set<SourceStorageBindings>>();
  const visited = new Map<SourceStorageSubject, Set<SourceStorageBindings>>();
  const pending: { readonly subject: SourceStorageSubject; readonly bindings: SourceStorageBindings;
    readonly transported?: true }[] = [{ subject, bindings }];
  while (pending.length !== 0) {
    const current = pending.pop()!;
    const visits = visited.get(current.subject) ?? new Set<SourceStorageBindings>();
    if (visits.has(current.bindings)) continue;
    visits.add(current.bindings);
    visited.set(current.subject, visits);
    const selected = sourceStorage.storageProducersFor(current.subject, current.bindings);
    if (selected.kind === "unresolved") return selected;
    if (selected.kind === "open") {
      if (selected.boundaries.length === 0) return { kind: "open", producers: Object.freeze(producers), boundaries: undefined };
      boundaries.push(...selected.boundaries);
    }
    for (const producer of selected.producers) {
      if (producer.subject.kind !== "input") {
        producers.push(producer);
        if (current.transported === true) transported.add(producer);
        continue;
      }
      const declaration = ast.parent(producer.subject.node);
      if (declaration === undefined) return { kind: "unresolved",
        reason: "Structural method storage requires the checked declaration of its parameter producer." };
      const canonical = sourceStorage.bindingsForDeclaration(declaration);
      if (canonical.kind === "unresolved") return canonical;
      const activations = producer.bindings === canonical.bindings
        ? { kind: "resolved" as const, activations: [{ kind: "declaration" as const }] }
        : sourceStorage.boundActivationsFor(declaration, producer.bindings);
      if (activations.kind === "unresolved") return activations;
      const invocations: { readonly bindings: SourceStorageBindings; readonly callerBindings: SourceStorageBindings }[] = [];
      for (const activation of activations.activations) {
        if (activation.kind === "invocation") {
          invocations.push(activation);
          continue;
        }
        if ("nativeEntry" in activation && activation.nativeEntry !== undefined) return { kind: "open", producers: Object.freeze(producers), boundaries: undefined };
        const summary = sourceStorage.source.navigation.declarationUseSummary(declaration);
        if (summary.exported || summary.bindingWritten) return { kind: "open", producers: Object.freeze(producers), boundaries: undefined };
        for (const use of sourceStorage.source.navigation.declarationUses(declaration)) {
          if (use.kind === "type-only") continue;
          const call = ast.parent(use.reference);
          if (use.kind !== "direct-call" || call === undefined || !ast.is.IsCallExpression(call) ||
            Node_Expression(ast, call) !== use.reference) return { kind: "open", producers: Object.freeze(producers), boundaries: undefined };
          const caller = sourceStorage.bindingsForLexicalOwner(call);
          if (caller.kind === "unresolved") return caller;
          const bound = sourceStorage.bindingsForInvocation(declaration, call, caller.bindings);
          if (bound.kind === "unresolved") return bound;
          invocations.push({ bindings: bound.bindings, callerBindings: caller.bindings });
        }
      }
      if (invocations.length === 0) return { kind: "open", producers: Object.freeze(producers), boundaries: undefined };
      const expanded = expandedInputs.get(producer.subject) ?? new Set<SourceStorageBindings>();
      expanded.add(producer.bindings);
      expandedInputs.set(producer.subject, expanded);
      for (const activation of invocations) pending.push({ subject: producer.subject, bindings: activation.bindings, transported: true });
    }
  }
  const remaining = boundaries.filter(boundary => boundary.kind !== "external-input" ||
    expandedInputs.get(boundary.subject)?.has(boundary.bindings) !== true);
  return remaining.length === 0 ? { kind: "complete", producers: Object.freeze(producers), transported }
    : { kind: "open", producers: Object.freeze(producers), boundaries: Object.freeze(remaining) };
}

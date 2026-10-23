import type { Node, Type } from "@tsonic/tsts";
import type { SourceStorageProducer, SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { RustFactWalk } from "../program/walk.js";

export function selectRustGeneratorReentry(walk: RustFactWalk, declaration: Node): "excluded" | "possible" {
  const { ast, sourceStorage: storage, source } = walk.context;
  const body = ast.body(declaration);
  if (body === undefined) return "possible";
  const scalar = (type: Type, at: Node, depth = 0): boolean => {
    if (depth >= 128) return false;
    const types = source.semantics.forNode(at).types;
    if (types.isUnion(type)) {
      const members = types.unionOrIntersectionTypes(type);
      return members.length !== 0 && members.every(member => scalar(member, at, depth + 1));
    }
    return types.isNever(type) || types.isNumberLike(type) || types.isBooleanLike(type) ||
      types.isStringLike(type) || types.isBigIntLike(type) || types.isSymbolLike(type) ||
      types.isNullish(type) || types.isVoidLike(type);
  };
  const immediate = (subject: SourceStorageSubject): boolean => {
    const checked = storage.typeFor(subject);
    return checked.kind === "resolved" && scalar(checked.type, subject.node);
  };
  const reads: SourceStorageSubject[] = [];
  let unproven = false;
  const visit = (node: Node): void => {
    const reference = ast.is.IsIdentifier(node) ? source.navigation.sourceReferenceFor(node) : undefined;
    if (reference !== undefined && walk.context.runtimeValueUses.isRuntimeReference(reference.declaration, node) ||
      ast.is.IsPropertyAccessExpression(node) || ast.is.IsElementAccessExpression(node)) {
      const selected = storage.subjectFor(node);
      if (selected.kind === "unresolved") unproven = true;
      else if (!immediate(selected.subject)) reads.push(selected.subject);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(body);
  if (unproven) return "possible";
  const creations: SourceStorageProducer[] = [];
  const creationCalls = new Set<Node>();
  for (const invocation of storage.invocations) {
    const checked = source.semantics.forNode(invocation).operations.call(invocation);
    const selected = checked === undefined ? undefined
      : source.semantics.forNode(invocation).declarations.signatureDeclaration(checked.selectedSignature);
    if (selected === undefined) continue;
    const implementation = source.navigation.callableImplementation(selected);
    if (selected !== declaration && (implementation.kind !== "resolved" ||
      implementation.implementation.declaration !== declaration)) continue;
    creationCalls.add(invocation);
    const caller = storage.bindingsForLexicalOwner(invocation);
    const subject = storage.subjectFor(invocation);
    if (caller.kind === "unresolved" || subject.kind === "unresolved") {
      if (reads.length !== 0) return "possible";
      continue;
    }
    const producers = storage.storageProducersFor(subject.subject, caller.bindings);
    if (producers.kind !== "complete" || producers.producers.length === 0) {
      if (reads.length !== 0) return "possible";
      continue;
    }
    for (const producer of producers.producers) {
      if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0 ||
        producer.subject.node !== invocation) {
        if (reads.length !== 0) return "possible";
        continue;
      }
      creations.push(producer);
    }
  }
  for (const boundary of storage.boundaries) for (const subject of boundary.subjects) {
    if (immediate(subject)) continue;
    const caller = storage.bindingsForLexicalOwner(boundary.invocation);
    if (caller.kind === "unresolved") return "possible";
    const producers = storage.storageProducersFor(subject, caller.bindings);
    if (producers.kind !== "complete" || producers.producers.length === 0 ||
      producers.producers.some(producer => creationCalls.has(producer.subject.node))) return "possible";
  }
  if (reads.length === 0) return storage.failureReason() === undefined ? "excluded" : "possible";
  if (creations.length === 0) return "possible";
  for (const creation of creations) {
    const activations = storage.boundActivationsFor(declaration, creation.bindings);
    if (activations.kind === "unresolved" || activations.activations.length === 0) return "possible";
    for (const activation of activations.activations) {
      if (activation.kind !== "invocation" || activation.invocation !== creation.subject.node) return "possible";
      const created = storage.invocationContextKeyFor(activation.invocation, activation.callerBindings);
      if (created.kind === "unresolved") return "possible";
      for (const read of reads) {
        const executions = storage.contributingExecutionsFor(read, declaration, creation);
        if (executions.kind !== "complete" || executions.producers.length === 0) return "possible";
        for (const execution of executions.producers) {
          const producers = storage.storageProducersFor(read, execution.bindings);
          if (producers.kind !== "complete" || producers.producers.length === 0) return "possible";
          for (const producer of producers.producers) {
            if (producer.subject.node !== activation.invocation) continue;
            const current = storage.invocationContextKeyFor(producer.subject.node, producer.bindings);
            if (current.kind === "unresolved" || current.key === created.key) return "possible";
          }
        }
      }
    }
  }
  return storage.failureReason() === undefined ? "excluded" : "possible";
}

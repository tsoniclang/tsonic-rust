import type { Node } from "@tsonic/tsts";
import { defaultSourceStorageLimits, type SourceStorageBindings, type SourceStorageSubject } from "@tsonic/target-api/analysis";
import { Node_Initializer, sourceLexicalEnvironment, sourceNodeIdentity, type SourceLexicalEnvironment } from "@tsonic/target-api/source";
import type { RustSourcePolicyContext } from "../model/context.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustRetainedEnvironment, RustRetainedEnvironmentSelection } from "./retained-environments.js";

type RustRetainedEnvironmentHost = Pick<RustSourcePolicyContext, "source" | "sourceStorage" | "sourceLifetimes">;
type LexicalSelection = SourceLexicalEnvironment | { readonly kind: "unresolved"; readonly reason: string };

export interface RustRetainedEnvironmentQueries {
  suspendedParametersFor(declaration: Node): readonly Node[] | undefined;
  lexicalFor(declaration: Node): LexicalSelection;
  environmentFor(declaration: Node): RustRetainedEnvironmentSelection;
}

export function createRustRetainedEnvironmentQueries(
  input: RustRetainedEnvironmentHost, maximumSteps = defaultSourceStorageLimits.maximumSteps,
): RustRetainedEnvironmentQueries {
  const { ast, navigation } = input.source;
  const storage = input.sourceStorage;
  const environments = new Map<Node, RustRetainedEnvironmentSelection>();
  const suspended = new Map<Node, readonly Node[] | undefined>();
  const lexical = new Map<Node, LexicalSelection>();
  let remaining = Number.isSafeInteger(maximumSteps) && maximumSteps > 0 ? maximumSteps : 0;
  const step = (): boolean => remaining > 0 && --remaining >= 0;
  const unresolved = (reason = "Retained native environments require exact declaration-owned storage within the finite source work budget.") =>
    Object.freeze({ kind: "unresolved" as const, reason });
  const none = Object.freeze({ kind: "none" as const });
  const suspendedParametersFor = (declaration: Node): readonly Node[] | undefined => {
    if (suspended.has(declaration)) return suspended.get(declaration);
    if (!step()) { suspended.set(declaration, undefined); return undefined; }
    const retained: Node[] = [];
    for (const parameter of ast.parameters(declaration)) {
      if (!step() || parameter === undefined) { suspended.set(declaration, undefined); return undefined; }
      const uses = navigation.parameterUseSummary(parameter);
      if (uses === undefined) { suspended.set(declaration, undefined); return undefined; }
      let used = false;
      for (const use of uses.uses) {
        if (!step()) { suspended.set(declaration, undefined); return undefined; }
        if (use.kind !== "type-only" && use.role !== "type-only") used = true;
      }
      if (used) retained.push(parameter);
    }
    const result = Object.freeze(retained);
    suspended.set(declaration, result);
    return result;
  };
  const lexicalFor = (declaration: Node): LexicalSelection => {
    const cached = lexical.get(declaration);
    if (cached !== undefined) return cached;
    const body = ast.body(declaration);
    if (!step() || body === undefined) return unresolved();
    const roots = [...ast.parameters(declaration).flatMap(parameter => {
      const initializer = parameter === undefined ? undefined : Node_Initializer(ast, parameter);
      return initializer === undefined ? [] : [initializer];
    }), body];
    const selected = sourceLexicalEnvironment(declaration, roots, ast, navigation);
    lexical.set(declaration, selected);
    return selected;
  };
  const isSuspended = (declaration: Node): boolean => ast.hasModifierKind(declaration, "async") ||
    input.source.semantics.forNode(declaration).operations.generator(declaration) !== undefined;
  const select = (declaration: Node): RustRetainedEnvironmentSelection => {
    if (!step()) return unresolved();
    if (ast.body(declaration) === undefined) return none;
    const parameters = ast.parameters(declaration);
    if (parameters.some(parameter => parameter === undefined)) return unresolved();
    const candidates = new Set(parameters);
    const retained = new Set<Node>();
    if (isSuspended(declaration)) {
      const selected = suspendedParametersFor(declaration);
      if (selected === undefined) return unresolved();
      selected.forEach(parameter => retained.add(parameter));
    } else {
      const subject = storage.subject(declaration, "return");
      const bindings = storage.bindingsForDeclaration(declaration);
      if (subject.kind !== "resolved" || bindings.kind !== "resolved") return unresolved();
      const producers = storage.storageProducersFor(subject.subject, bindings.bindings);
      if (producers.kind === "unresolved") return unresolved(producers.reason);
      const visited = new Map<SourceStorageSubject, Set<SourceStorageBindings>>();
      const retain = (subject: SourceStorageSubject, bindings: SourceStorageBindings): boolean => {
        const pending = [{ subject, bindings }];
        while (pending.length !== 0) {
          if (!step()) return false;
          const { subject, bindings } = pending.pop()!;
          const visits = visited.get(subject) ?? new Set<SourceStorageBindings>();
          if (visits.has(bindings)) continue;
          visits.add(bindings);
          visited.set(subject, visits);
          const origins = storage.boundOriginsFor(subject, bindings);
          if (origins.kind !== "resolved") return false;
          for (const origin of origins.subjects) {
            if (!step()) return false;
            if (origin.kind === "input") {
              if (candidates.has(origin.node)) retained.add(origin.node);
              continue;
            }
            if (origin.kind !== "value" || origin.projection.length !== 0 || ast.body(origin.node) === undefined) continue;
            const captures = lexicalFor(origin.node);
            if (captures.kind === "unresolved") return false;
            for (const capture of captures.captures) {
              if (!step()) return false;
              const source = storage.subjectFor(capture.references[0]!);
              if (source.kind !== "resolved") return false;
              pending.push({ subject: source.subject, bindings });
            }
          }
        }
        return true;
      };
      if (!retain(subject.subject, bindings.bindings)) return unresolved();
      for (const producer of producers.producers) {
        if (!step()) return unresolved();
        const node = producer.subject.node;
        if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0 || !ast.is.IsCallExpression(node)) continue;
        const semantics = input.source.semantics.forNode(node);
        const call = semantics.operations.call(node);
        const selected = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
        const implementation = selected === undefined ? undefined : navigation.callableImplementation(selected);
        if (implementation?.kind !== "resolved") continue;
        const owner = implementation.implementation.declaration;
        if (!isSuspended(owner)) continue;
        const activation = storage.bindingsForInvocation(owner, node, producer.bindings);
        const parameters = suspendedParametersFor(owner);
        if (activation.kind !== "resolved" || parameters === undefined) return unresolved();
        for (const parameter of parameters) {
          if (!step()) return unresolved();
          const input = storage.subject(parameter, "input");
          if (input.kind !== "resolved" || !retain(input.subject, activation.bindings)) return unresolved();
        }
      }
    }
    const selected = parameters.filter((parameter): parameter is Node => parameter !== undefined && retained.has(parameter));
    if (selected.length === 0) return none;
    const identity = sourceNodeIdentity(ast, declaration);
    if (identity === undefined) return unresolved();
    const names = new Set<string>();
    for (let owner: Node | undefined = declaration; owner !== undefined; owner = ast.parent(owner)) {
      if (!step()) return unresolved();
      for (const parameter of input.sourceLifetimes.contractFor(owner)?.parameters ?? [])
        if (parameter.kind === "lifetime") names.add(parameter.lifetime.name);
    }
    const environment: RustRetainedEnvironment = Object.freeze({
      lifetime: Object.freeze({ kind: "parameter", identity: `retained-environment\0${identity}`,
        name: allocateRustGeneratedName(names, "environment") }), parameters: Object.freeze(selected) });
    return Object.freeze({ kind: "selected", environment });
  };
  return Object.freeze({ suspendedParametersFor, lexicalFor, environmentFor(declaration: Node) {
    const cached = environments.get(declaration);
    if (cached !== undefined) return cached;
    const selected = select(declaration);
    environments.set(declaration, selected);
    return selected;
  } });
}

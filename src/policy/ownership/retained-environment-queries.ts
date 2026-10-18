import type { Node } from "@tsonic/tsts";
import { defaultSourceStorageLimits, type SourceStorageBindings, type SourceStorageProjection, type SourceStorageSubject } from "@tsonic/target-api/analysis";
import { Node_Initializer, sourceLexicalEnvironment, sourceNodeIdentity,
  type SourceLexicalEnvironment, type SourceNodeDomain } from "@tsonic/target-api/source";
import type { RustSourcePolicyContext } from "../model/context.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustRetainedEnvironment } from "../../target-model/records/retained-environments.js";
import type { RustRetainedEnvironmentSelection } from "./retained-environments.js";

type RustRetainedEnvironmentHost = Pick<RustSourcePolicyContext, "source" | "sourceStorage" | "sourceLifetimes"> & {
  readonly domain: SourceNodeDomain;
};
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
  const includes = (node: Node): boolean => input.domain === "source" || input.domain.has(node);
  const environments = new Map<Node, RustRetainedEnvironmentSelection>();
  const suspended = new Map<Node, readonly Node[] | undefined>();
  const lexical = new Map<Node, LexicalSelection>();
  let opaqueInvocations: ReadonlySet<Node> | undefined;
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
        if (!includes(use.reference)) continue;
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
    const selected = sourceLexicalEnvironment(declaration, roots, ast, navigation, input.domain);
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
      const subject = storage.subject(declaration, ast.is.IsConstructorDeclaration(declaration) ? "receiver" : "return");
      const bindings = storage.bindingsForDeclaration(declaration);
      if (subject.kind !== "resolved" || bindings.kind !== "resolved") return unresolved();
      const producers = storage.storageProducersFor(subject.subject, bindings.bindings);
      if (producers.kind === "unresolved") return unresolved(producers.reason);
      const visited = new Map<SourceStorageSubject, Set<SourceStorageBindings>>();
      const retain = (subject: SourceStorageSubject, bindings: SourceStorageBindings): boolean => {
        const pending = [{ subject, bindings }];
        const components = (subject: SourceStorageSubject, bindings: SourceStorageBindings): boolean => {
          if (!step()) return false;
          if (opaqueInvocations === undefined) {
            const invocations = new Set<Node>();
            for (const boundary of storage.boundaries) {
              if (boundary.kind === "opaque-invocation" && !includes(boundary.invocation)) continue;
              if (!step()) return false;
              if (boundary.kind === "opaque-invocation") invocations.add(boundary.invocation);
            }
            opaqueInvocations = invocations;
          }
          if (opaqueInvocations.has(subject.node)) return true;
          const selected = storage.typeFor(subject);
          if (selected.kind === "unresolved") return false;
          const semantics = input.source.semantics.forFile(selected.sourceFile);
          const types = semantics.types;
          const type = types.nonNullableType(selected.type);
          if (type === undefined) return false;
          if (types.isNullish(type) || types.isNever(type) || types.isVoidLike(type) ||
            types.isStringLike(type) || types.isNumberLike(type) || types.isBooleanLike(type) ||
            types.isBigIntLike(type) || types.isSymbolLike(type) || types.callSignatures(type).length !== 0) return true;
          if (types.isAny(type) || types.isUnknown(type)) return false;
          const projections: SourceStorageProjection[] = [];
          if (types.isTuple(type)) {
            for (const [index, element] of types.tupleElementInfos(type).entries()) {
              if (!step()) return false;
              if (element.elementKind === "required" || element.elementKind === "optional")
                projections.push({ kind: "tuple-element", index });
            }
          } else if (types.isArrayLike(type)) projections.push({ kind: "array-element" });
          else {
            const members = types.structuralMembers(type, type, "read");
            if (members.kind !== "available") return false;
            for (const member of members.members) {
              if (!step()) return false;
              if (member.kind !== "present" || member.source.read !== "method" && member.source.read !== "property") continue;
              for (const declaration of member.source.declarations) {
                if (!step()) return false;
                projections.push({ kind: member.source.read === "method" ? "method-value" : "member", declaration });
              }
            }
          }
          for (const projection of projections) {
            if (!step()) return false;
            const child = storage.subject(subject.node, subject.kind, [...subject.projection, projection]);
            if (child.kind === "unresolved") return false;
            const values = storage.storageProducersFor(child.subject, bindings);
            if (values.kind === "unresolved") return false;
            for (const producer of values.producers) {
              if (!step()) return false;
              pending.push({ subject: producer.subject, bindings: producer.bindings });
            }
          }
          return true;
        };
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
            if (origin.kind !== "value" || origin.projection.length !== 0 || ast.body(origin.node) === undefined) {
              if (!components(origin, bindings)) return false;
              continue;
            }
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
      for (const producer of producers.producers) {
        if (!step() || !retain(producer.subject, producer.bindings)) return unresolved();
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

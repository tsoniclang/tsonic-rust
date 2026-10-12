import type { Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageSubject } from "@tsonic/target-api/analysis";
import { sourceLexicalEnvironment, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustSourcePolicyContext } from "../model/context.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustCallableProtocol, rustNativeCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";

export interface RustRetainedEnvironment {
  readonly lifetime: Extract<RustLifetimeRef, { readonly kind: "parameter" }>;
  readonly parameters: readonly Node[];
}

export type RustRetainedEnvironmentSelection =
  | { readonly kind: "none" }
  | { readonly kind: "selected"; readonly environment: RustRetainedEnvironment }
  | { readonly kind: "unresolved"; readonly reason: string };

export function rustSuspendedCapturedParameters(declaration: Node, context: RustSourcePolicyContext): readonly Node[] {
  const { ast } = context;
  const parameters = ast.parameters(declaration).filter((parameter): parameter is Node => parameter !== undefined);
  const retained = new Set<Node>();
  const visit = (node: Node): void => {
    if (ast.is.IsFunctionExpression(node) || ast.is.IsFunctionDeclaration(node) ||
      ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node)) return;
    if (ast.kindName(node) === "KindIdentifier") {
      let selected = context.source.navigation.sourceReferenceFor(node)?.declaration;
      while (selected !== undefined) {
        if (parameters.includes(selected)) { retained.add(selected); break; }
        selected = ast.parent(selected);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  const body = ast.body(declaration);
  if (body !== undefined) visit(body);
  return Object.freeze(parameters.filter(parameter => retained.has(parameter)));
}

export function rustRetainedEnvironment(
  declaration: Node,
  parameterCarriers: readonly (TargetTypeRef | undefined)[],
  context: RustSourcePolicyContext,
): RustRetainedEnvironmentSelection {
  const { ast, sourceStorage: storage } = context;
  const none = Object.freeze({ kind: "none" as const });
  const unresolved = (): RustRetainedEnvironmentSelection => ({ kind: "unresolved",
    reason: "A retained native environment requires exact declaration-owned input and producer storage." });
  if (ast.body(declaration) === undefined) return none;
  const parameters = ast.parameters(declaration);
  if (parameters.length !== parameterCarriers.length || parameters.some(parameter => parameter === undefined) ||
    parameterCarriers.some(carrier => carrier === undefined)) return unresolved();
  if (!parameterCarriers.some(carrier => carrier !== undefined && rustHasOpenOwnedStorage(carrier))) return none;
  const candidates = new Set(parameters.filter((parameter): parameter is Node => parameter !== undefined));
  const retained = new Set<Node>();
  if (ast.hasModifierKind(declaration, "async") || context.semanticsFor(declaration).operations.generator(declaration) !== undefined) {
    rustSuspendedCapturedParameters(declaration, context).forEach(parameter => retained.add(parameter));
  } else {
    const subject = storage.subject(declaration, "return");
    const bindings = storage.bindingsForDeclaration(declaration);
    if (subject.kind !== "resolved" || bindings.kind !== "resolved") return unresolved();
    const producers = storage.storageProducersFor(subject.subject, bindings.bindings);
    if (producers.kind === "unresolved") return unresolved();
    const visited = new Map<Node, Set<SourceStorageBindings>>();
    const retain = (subject: SourceStorageSubject, bindings: SourceStorageBindings): boolean => {
      const origins = storage.boundOriginsFor(subject, bindings);
      if (origins.kind !== "resolved") return false;
      for (const origin of origins.subjects) {
        if (origin.kind === "input") {
          if (candidates.has(origin.node)) retained.add(origin.node);
          continue;
        }
        if (origin.kind !== "value" || origin.projection.length !== 0 || ast.body(origin.node) === undefined) continue;
        const visits = visited.get(origin.node) ?? new Set<SourceStorageBindings>();
        if (visits.has(bindings)) continue;
        visits.add(bindings);
        visited.set(origin.node, visits);
        const lexical = sourceLexicalEnvironment(origin.node, [ast.body(origin.node)!], ast, context.source.navigation);
        if (lexical.kind === "unresolved") return false;
        for (const capture of lexical.captures) {
          const source = storage.subjectFor(capture.references[0]!);
          if (source.kind !== "resolved" || !retain(source.subject, bindings)) return false;
        }
      }
      return true;
    };
    if (!retain(subject.subject, bindings.bindings)) return unresolved();
    for (const producer of producers.producers) {
      const node = producer.subject.node;
      if (producer.subject.kind !== "value" || producer.subject.projection.length !== 0 || !ast.is.IsCallExpression(node)) continue;
      const semantics = context.semanticsFor(node);
      const call = semantics.operations.call(node);
      const selected = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
      const implementation = selected === undefined ? undefined : context.source.navigation.callableImplementation(selected);
      if (implementation?.kind !== "resolved") continue;
      const owner = implementation.implementation.declaration;
      if (!ast.hasModifierKind(owner, "async") && context.semanticsFor(owner).operations.generator(owner) === undefined) continue;
      const activation = storage.bindingsForInvocation(owner, node, producer.bindings);
      if (activation.kind !== "resolved") return unresolved();
      for (const parameter of rustSuspendedCapturedParameters(owner, context)) {
        const input = storage.subject(parameter, "input");
        if (input.kind !== "resolved" || !retain(input.subject, activation.bindings)) return unresolved();
      }
    }
  }
  const selected = parameters.filter((parameter): parameter is Node => parameter !== undefined && retained.has(parameter));
  if (!selected.some(parameter => {
    const carrier = parameterCarriers[parameters.indexOf(parameter)];
    return carrier !== undefined && rustHasOpenOwnedStorage(carrier);
  })) return none;
  const identity = sourceNodeIdentity(ast, declaration);
  if (identity === undefined) return unresolved();
  const names = new Set<string>();
  for (let owner: Node | undefined = declaration; owner !== undefined; owner = ast.parent(owner)) {
    for (const parameter of context.sourceLifetimes.contractFor(owner)?.parameters ?? [])
      if (parameter.kind === "lifetime") names.add(parameter.lifetime.name);
  }
  return Object.freeze({ kind: "selected", environment: Object.freeze({
    lifetime: Object.freeze({ kind: "parameter", identity: `retained-environment\0${identity}`,
      name: allocateRustGeneratedName(names, "environment") }), parameters: Object.freeze(selected) }) });
}

export function rustHasOpenOwnedStorage(carrier: TargetTypeRef): boolean {
  if (carrier.kind === "reference" || carrier.kind === "pointer") return false;
  if (rustCallableProtocol(carrier) !== undefined || rustGenericCallableProtocol(carrier) !== undefined ||
    rustNativeCallableProtocol(carrier) !== undefined || carrier.kind === "type-parameter") return true;
  return rustTargetGenericReferences(carrier).typeIdentities.length > 0 ||
    rustTargetTypeChildren(carrier).some(rustHasOpenOwnedStorage);
}


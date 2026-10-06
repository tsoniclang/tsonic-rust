import type { Node } from "@tsonic/tsts";
import { Node_Initializer, sourceLexicalEnvironment } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustTargetType } from "./target.js";
import { rustSourceTypeParameter } from "../../../target-model/names/type-parameters.js";
import { substituteRustTargetTypeParameters } from "../../../target-model/types/carriers/substitution.js";

export function resolveRustCallableEnvironment(
  declaration: Node | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  excludedCaptures: ReadonlySet<Node> = new Set(),
): readonly TargetTypeRef[] | undefined {
  const body = declaration === undefined ? undefined : context.ast.body(declaration);
  if (declaration === undefined || body === undefined) return [];
  const roots = [...context.ast.parameters(declaration).flatMap(parameter => {
    const initializer = parameter === undefined ? undefined : Node_Initializer(context.ast, parameter);
    return initializer === undefined ? [] : [initializer];
  }), body];
  const lexical = sourceLexicalEnvironment(declaration, roots, context.ast, context.source.navigation);
  if (lexical.kind === "unresolved") return undefined;
  const parameters = new Map<string, Extract<TargetTypeRef, { readonly kind: "type-parameter" }>>();
  for (const reference of [...lexical.captures.filter(capture => !excludedCaptures.has(capture.declaration))
    .flatMap(capture => capture.references.slice(0, 1)),
    ...lexical.receivers.filter(receiver => !excludedCaptures.has(receiver.owner))
      .flatMap(receiver => receiver.references.slice(0, 1))]) {
    const semantics = context.semanticsFor(reference);
    const refinement = context.source.semantics.selectValueTypeRefinement(reference);
    if (refinement.kind === "unresolved") return undefined;
    const type = refinement.kind === "resolved" ? refinement.declaredType : semantics.types.expressionType(reference);
    const selected = context.sourceStorage.subjectFor(reference);
    if (selected.kind === "unresolved") return undefined;
    const carrier = resolveRustTargetType(type, { ...context, currentSemantics: semantics,
      sourceStorageSubject: selected.subject,
      sourceTypeParameterSubstitutions: new Map() }, options, resolving);
    if (carrier === undefined) return undefined;
    for (const parameter of rustTargetGenericReferences(carrier).typeParameters) parameters.set(parameter.identity, parameter);
  }
  return Object.freeze([...parameters.values()]);
}

export function bindRustCallableEnvironment(
  carrier: TargetTypeRef | undefined,
  context: RustTargetTypeResolutionContext,
): TargetTypeRef | undefined {
  if (carrier === undefined) return undefined;
  const substitutions = new Map<string, TargetTypeRef>();
  for (const [declaration, binding] of context.sourceTypeParameterSubstitutions ?? []) {
    const parameter = rustSourceTypeParameter(declaration, context.ast);
    if (parameter === undefined) return undefined;
    substitutions.set(parameter.identity, binding.carrier);
  }
  return substituteRustTargetTypeParameters(carrier, substitutions);
}

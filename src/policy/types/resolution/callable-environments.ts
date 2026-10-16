import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustTargetType } from "./target.js";
import { rustSourceTypeParameter } from "../../../target-model/names/type-parameters.js";
import { substituteRustTargetTypeParameters } from "../../../target-model/types/carriers/substitution.js";
import { rustSourceStorageProjectedCarrier } from "../objects/value-domain-carrier.js";

export function resolveRustCallableEnvironment(
  declaration: Node | undefined,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
  excludedCaptures: ReadonlySet<Node> = new Set(),
): readonly TargetTypeRef[] | undefined {
  const body = declaration === undefined ? undefined : context.ast.body(declaration);
  if (declaration === undefined || body === undefined) return [];
  const lexical = context.retainedEnvironments.lexicalFor(declaration);
  if (lexical.kind === "unresolved") return undefined;
  const carriers: TargetTypeRef[] = [];
  for (const reference of [...lexical.captures.filter(capture => !excludedCaptures.has(capture.declaration) &&
    context.records.compileTimeSource.get(capture.declaration) !== true)
    .flatMap(capture => capture.references.slice(0, 1)),
    ...lexical.receivers.filter(receiver => !excludedCaptures.has(receiver.owner))
      .flatMap(receiver => receiver.references.slice(0, 1))]) {
    const semantics = context.semanticsFor(reference);
    const refinement = context.source.semantics.selectValueTypeRefinement(reference);
    if (refinement.kind === "unresolved") return undefined;
    const type = refinement.kind === "resolved" ? refinement.declaredType : semantics.types.expressionType(reference);
    const selected = context.sourceStorage.storageSubjectFor(reference);
    if (selected.kind === "unresolved") return undefined;
    let carrier: TargetTypeRef | undefined;
    if (selected.subject.kind === "input") {
      const owner = context.ast.parent(selected.subject.node);
      if (owner === undefined || options.callableParameterCarriers(owner) === undefined) return undefined;
      const abi = context.records.sourceParameterAbi.get(selected.subject.node);
      if (abi === undefined) return undefined;
      carrier = rustSourceStorageProjectedCarrier({ sourceStorage: context.sourceStorage,
        sourceTypes: options.sourceTypes, projectFieldProjection: options.projectFieldProjection,
        types: { resolveNode: node => context.records.runtimeCarrier.get(node)?.carrier },
        semantics: context.semantics,
      }, selected.subject, abi.valueCarrier);
    } else {
      const storageCarrier = selected.subject.kind === "value" && selected.subject.projection.length === 0
        ? context.records.runtimeCarrier.get(selected.subject.node)?.carrier : undefined;
      carrier = storageCarrier ?? resolveRustTargetType(type, { ...context, currentSemantics: semantics,
        sourceStorageSubject: selected.subject,
        sourceTypeParameterSubstitutions: new Map() }, options, resolving);
    }
    if (carrier === undefined) return undefined;
    carriers.push(carrier);
  }
  return Object.freeze(carriers);
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

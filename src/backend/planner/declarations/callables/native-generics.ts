import type { Node } from "@tsonic/tsts";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";
import type { RustGenericParameter, RustGenerics, RustWherePredicate } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustCallableGenericPlan } from "./generics.js";
import { rustErrorEffectsFactKey } from "../../../../analysis/facts/error-effects.js";
import { rustTargetTypeChildren } from "../../../../target-model/types/carriers/children.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";
import { rustContextualValueConversionFactKey, rustSourceCallableReturnFactKey } from "../../../../analysis/facts/keys.js";

export function planRustNativeCallableGenerics(
  declaration: Node,
  source: RustCallableGenericPlan,
): RustCallableGenericPlan | undefined {
  const native = source.context.input.program.callableValues.native;
  const { nativeStorage } = source.context.input.program.callableValues;
  const inputs = [...new Map([...native.inputsFor(declaration), ...native.capturesFor(declaration),
    ...nativeStorage.futureInputsFor(declaration), ...nativeStorage.futureCapturesFor(declaration)]
    .map(input => [input.implementation.identity, input] as const)).values()];
  if (inputs.length === 0) return source;
  const sourceGenerics = source.finalizeGenerics();
  const typeParameterNames = new Map(source.context.typeParameterNames);
  const usedNames = new Set([...typeParameterNames.values(), ...sourceGenerics.parameters.map(parameter => parameter.name)]);
  for (const input of inputs) {
    if (source.context.typeParameterSubstitutions?.has(input.implementation.identity) === true) continue;
    typeParameterNames.set(input.implementation.identity, allocateRustGeneratedName(usedNames, input.implementation.name));
  }
  const context: RustPlanContext = { ...source.context, typeParameterNames };
  const bounds = new Map(inputs.map(input => [input.implementation.identity, new Map<string, TargetTypeRef>()]));
  const visited = new Set<TargetTypeRef>();
  const collect = (type: TargetTypeRef): void => {
    if (visited.has(type)) return;
    visited.add(type);
    if (type.kind === "associated-type" && type.owner.kind === "type-parameter" && type.trait !== undefined)
      bounds.get(type.owner.identity)?.set(closedMetadataKey(type.trait), type.trait);
    for (const child of rustTargetTypeChildren(type)) collect(child);
  };
  if (context.input.program.facts.getFact(declaration, rustSourceCallableReturnFactKey) !== undefined) {
    const selected = nativeStorage.returnFor(declaration);
    if (selected.kind === "unresolved") return undefined;
    collect(selected.carrier);
  }
  let resolved = true;
  const visit = (node: Node): void => {
    if (!resolved) return;
    for (const error of context.input.program.facts.getFact(node, rustErrorEffectsFactKey)?.nativeErrors ?? [])
      collect(error.errorType);
    if (context.input.program.facts.getFact(node, rustContextualValueConversionFactKey)?.conversion.kind === "callable-adapter") {
      const selected = nativeStorage.valueFor(node);
      if (selected.kind === "unresolved") { resolved = false; return; }
      collect(selected.carrier);
    }
    const call = native.callFor(node);
    if (call !== undefined) bounds.get(call.input.implementation.identity)?.set(
      closedMetadataKey(call.input.trait), call.input.trait);
    context.input.program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(declaration);
  if (!resolved) return undefined;
  for (const forwarding of context.input.program.callableValues.nativeGenericProducers.forwardingFor(declaration)) {
    const selected = bounds.get(forwarding.input.implementation.identity);
    if (selected === undefined) return undefined;
    selected.set(closedMetadataKey(forwarding.trait), forwarding.trait);
  }
  const parameters: RustGenericParameter[] = [];
  const predicates: RustWherePredicate[] = [...sourceGenerics.wherePredicates];
  for (const input of inputs) {
    const traits = [...bounds.get(input.implementation.identity)!.values()].map(trait => rustTypeFromCarrierInContext(trait, context));
    if (traits.some(trait => trait === undefined)) return undefined;
    const selectedBounds = traits.map(trait => ({ kind: "trait-type" as const, reference: { trait: trait! } }));
    if (context.typeParameterSubstitutions?.has(input.implementation.identity) === true) {
      const type = rustTypeFromCarrierInContext(input.implementation, context);
      if (type === undefined) return undefined;
      if (selectedBounds.length > 0) predicates.push({ kind: "type", type, bounds: selectedBounds });
    } else parameters.push({ kind: "type", name: typeParameterNames.get(input.implementation.identity)!, bounds: selectedBounds });
  }
  const generics: RustGenerics = { parameters: [...sourceGenerics.parameters, ...parameters],
    wherePredicates: predicates };
  return { ...source, context, finalizeGenerics: () => generics };
}

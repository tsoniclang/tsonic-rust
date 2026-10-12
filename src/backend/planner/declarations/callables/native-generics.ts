import type { Node } from "@tsonic/tsts";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";
import type { RustGenericParameter, RustGenerics } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustCallableGenericPlan } from "./generics.js";
import { rustErrorEffectsFactKey } from "../../../../analysis/facts/error-effects.js";
import { rustTargetTypeChildren } from "../../../../target-model/types/carriers/children.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function planRustNativeCallableGenerics(
  declaration: Node,
  source: RustCallableGenericPlan,
): RustCallableGenericPlan | undefined {
  const native = source.context.input.program.callableValues.native;
  const inputs = [...new Set([...native.inputsFor(declaration), ...native.capturesFor(declaration)])];
  if (inputs.length === 0) return source;
  const sourceGenerics = source.finalizeGenerics();
  const typeParameterNames = new Map(source.context.typeParameterNames);
  const usedNames = new Set([...typeParameterNames.values(), ...sourceGenerics.parameters.map(parameter => parameter.name)]);
  for (const input of inputs) typeParameterNames.set(input.implementation.identity,
    allocateRustGeneratedName(usedNames, input.implementation.name));
  const context: RustPlanContext = { ...source.context, typeParameterNames };
  const bounds = new Map(inputs.map(input => [input.implementation.identity, new Map<string, TargetTypeRef>()]));
  const collect = (type: TargetTypeRef, visited: Set<TargetTypeRef>): void => {
    if (visited.has(type)) return;
    visited.add(type);
    if (type.kind === "associated-type" && type.owner.kind === "type-parameter" && type.trait !== undefined)
      bounds.get(type.owner.identity)?.set(closedMetadataKey(type.trait), type.trait);
    for (const child of rustTargetTypeChildren(type)) collect(child, visited);
  };
  const visit = (node: Node): void => {
    for (const error of context.input.program.facts.getFact(node, rustErrorEffectsFactKey)?.nativeErrors ?? [])
      collect(error.errorType, new Set());
    const call = native.callFor(node);
    if (call !== undefined) bounds.get(call.input.implementation.identity)?.set(
      closedMetadataKey(call.input.protocol.trait), call.input.protocol.trait);
    context.input.program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(declaration);
  for (const forwarding of context.input.program.callableValues.nativeGenericProducers.forwardingFor(declaration)) {
    const selected = bounds.get(forwarding.input.implementation.identity);
    if (selected === undefined) return undefined;
    selected.set(closedMetadataKey(forwarding.trait), forwarding.trait);
  }
  const parameters: RustGenericParameter[] = [];
  for (const input of inputs) {
    const traits = [...bounds.get(input.implementation.identity)!.values()].map(trait => rustTypeFromCarrierInContext(trait, context));
    if (traits.some(trait => trait === undefined)) return undefined;
    parameters.push({ kind: "type", name: typeParameterNames.get(input.implementation.identity)!,
      bounds: traits.map(trait => ({ kind: "trait-type", reference: { trait: trait! } })) });
  }
  const generics: RustGenerics = { parameters: [...sourceGenerics.parameters, ...parameters],
    wherePredicates: sourceGenerics.wherePredicates };
  return { ...source, context, finalizeGenerics: () => generics };
}

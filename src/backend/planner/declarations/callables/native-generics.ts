import type { Node } from "@tsonic/tsts";
import { allocateRustGeneratedName } from "../../../../target-model/names/generated.js";
import type { RustGenericParameter, RustGenerics, RustWherePredicate, RustTypeBound } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustCallableGenericPlan } from "./generics.js";
import { rustGenericRequirementBounds, rustGenericsWithAssociatedBounds } from "../../types/generic-bounds.js";
import { rustAssociatedPredicates } from "../../types/associated-bounds.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function planRustNativeCallableGenerics(
  declaration: Node,
  source: RustCallableGenericPlan,
): RustCallableGenericPlan {
  const selected = source.context.input.program.records.nativeGenerics.get(declaration);
  if (selected === undefined) failRustPlannerInvariant(
    "An emitted native callable requires its exact original pre-seal generic context.", declaration);
  const { inputs } = selected;
  const requirements = source.context.promiseBody === true ? selected.bodyRequirements : selected.sourceRequirements;
  if (inputs.length === 0 && requirements === undefined) return source;
  if (requirements === undefined) failRustPlannerInvariant(
    "An emitted native callable generic context requires its finalized declaration requirements.", declaration);
  const sourceGenerics = source.finalizeGenerics();
  const typeParameterNames = new Map(source.context.typeParameterNames);
  const usedNames = new Set([...typeParameterNames.values(), ...sourceGenerics.parameters.map(parameter => parameter.name)]);
  for (const input of inputs) {
    if (!source.selection.nativeBinders.has(input.implementation.identity)) continue;
    typeParameterNames.set(input.implementation.identity, allocateRustGeneratedName(usedNames, input.implementation.name));
  }
  const context: RustPlanContext = { ...source.context, typeParameterNames };
  const parameters: RustGenericParameter[] = [];
  const parameterSlots = new Map(source.parameterSlots);
  const predicates: RustWherePredicate[] = [...sourceGenerics.wherePredicates,
    ...rustAssociatedPredicates(requirements.associatedTypes, context)];
  for (const input of inputs) {
    const traits = input.traits.map(trait => rustTypeFromCarrierInContext(trait, context));
    if (traits.some(trait => trait === undefined)) failRustPlannerInvariant("An admitted native generic input requires its renderable trait bounds.", declaration);
    const selectedBounds: RustTypeBound[] = traits.map(trait => ({ kind: "trait-type" as const, reference: { trait: trait! } }));
    const required = requirements.nativeInputs.find(parameter => parameter.identity === input.implementation.identity);
    if (required !== undefined) selectedBounds.push(...rustGenericRequirementBounds(required.requirements));
    if (input.retained !== undefined) {
      selectedBounds.push({ kind: "lifetime", lifetime: { kind: "static" } });
      const error = rustTypeFromCarrierInContext(input.retained.error, context);
      if (error === undefined) failRustPlannerInvariant("An admitted retained native input requires its renderable error carrier.", declaration);
      for (const target of input.retained.targets) {
        const type = rustTypeFromCarrierInContext(target, context);
        if (type === undefined) failRustPlannerInvariant("An admitted retained native input requires its renderable error target.", declaration);
        predicates.push({ kind: "type", type: error, bounds: [{ kind: "trait-type", reference: {
          trait: { kind: "named", path: "core::convert::Into", genericArguments: [{ kind: "type", type }] },
        } }] });
      }
    }
    if (input.caught !== undefined) {
      // An input invoked in a catching try body converts its invocation error into the catch's program error.
      const error = rustTypeFromCarrierInContext(input.caught.error, context);
      const target = rustTypeFromCarrierInContext(input.caught.target, context);
      if (error === undefined || target === undefined) failRustPlannerInvariant("An admitted caught native input requires its renderable error conversion.", declaration);
      predicates.push({ kind: "type", type: error, bounds: [{ kind: "trait-type", reference: {
        trait: { kind: "named", path: "core::convert::Into", genericArguments: [{ kind: "type", type: target }] },
      } }] });
    }
    if (!source.selection.nativeBinders.has(input.implementation.identity)) {
      // A substituted implementation is named only where it carries a bound (a transport-only capture needs none).
      if (selectedBounds.length === 0) continue;
      const type = rustTypeFromCarrierInContext(input.implementation, context);
      if (type === undefined) failRustPlannerInvariant("An admitted native generic input requires its renderable implementation carrier.", declaration);
      predicates.push({ kind: "type", type, bounds: selectedBounds });
    } else {
      parameterSlots.set(input.implementation.identity, sourceGenerics.parameters.length + parameters.length);
      parameters.push({ kind: "type", name: typeParameterNames.get(input.implementation.identity)!, bounds: selectedBounds });
    }
  }
  // An input the source predicates already name (its associated error obligation names its owner trait) keeps all its
  // bounds in that one predicate; a bound in both places is rejected by clippy (multiple_bound_locations).
  const generics: RustGenerics = rustGenericsWithAssociatedBounds([...sourceGenerics.parameters, ...parameters], predicates);
  return { ...source, context, parameterSlots, finalizeGenerics: () => generics };
}

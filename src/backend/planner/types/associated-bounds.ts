import type { Node } from "@tsonic/tsts";
import type { RustWherePredicate } from "../../target-ast/nodes.js";
import type { RustAssociatedTypeRequirement } from "../../../analysis/declarations/associated-requirements.js";
import { rustGenericRequirementBounds } from "./generic-bounds.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "./render.js";

export function rustDeclarationAssociatedPredicates(
  declaration: Node,
  context: RustPlanContext,
): readonly RustWherePredicate[] {
  const contract = context.input.program.declarationGenericRequirements.contractFor(declaration);
  if (contract === undefined) throw new Error("A Rust declaration has no sealed generic requirement contract.");
  return rustAssociatedPredicates(contract.associatedTypes, context);
}

export function rustAssociatedPredicates(
  requirements: readonly RustAssociatedTypeRequirement[],
  context: RustPlanContext,
): readonly RustWherePredicate[] {
  const predicates: RustWherePredicate[] = [];
  for (const selected of requirements) {
    const projection = selected.carrier;
    const owner = rustTypeFromCarrierInContext(projection.owner, context);
    const trait = rustTypeFromCarrierInContext(projection.trait, context);
    const type = rustTypeFromCarrierInContext(projection, context);
    if (owner === undefined || trait === undefined || type === undefined) {
      throw new Error("A sealed dependent type obligation has no native syntax.");
    }
    predicates.push({ kind: "type", type: owner, bounds: [{ kind: "trait-type", reference: { trait } }] });
    if (selected.requirements.length > 0) predicates.push({ kind: "type", type,
      bounds: rustGenericRequirementBounds(selected.requirements),
    });
  }
  return Object.freeze(predicates);
}

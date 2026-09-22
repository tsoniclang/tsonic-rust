import type { Node } from "@tsonic/tsts";
import type { RustWherePredicate } from "../../target-ast/nodes.js";
import type { RustAssociatedTypeRequirement } from "../../../analysis/declarations/associated-requirements.js";
import { rustGenericRequirementBounds } from "./generic-bounds.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "./render.js";
import type { RustTypeRenderingContext } from "./render.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import { rustProjectProjectionPredicates } from "./project-projection-bounds.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function rustDeclarationAssociatedPredicates(
  declaration: Node,
  context: RustPlanContext,
  inScope: (carrier: TargetTypeRef) => boolean = () => true,
): readonly RustWherePredicate[] {
  const contract = context.input.program.declarationGenericRequirements.contractFor(declaration);
  if (contract === undefined) throw new Error("A Rust declaration has no sealed generic requirement contract.");
  return [...rustAssociatedPredicates(contract.associatedTypes.filter(requirement => inScope(requirement.carrier)), context),
    ...rustProjectProjectionPredicates(contract.projectProjections.filter(requirement =>
      inScope(requirement.sourceCarrier) && inScope(requirement.targetCarrier)), context)];
}

export function rustAssociatedPredicates(
  requirements: readonly RustAssociatedTypeRequirement[],
  context: RustTypeRenderingContext,
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
    for (const access of selected.fieldAccess ?? []) {
      const key = projection.trait?.genericArguments[0];
      const keyType = key?.kind === "type" ? rustTypeFromCarrierInContext(key.type, context) : undefined;
      const errorType = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
      if (keyType === undefined || errorType === undefined) throw new Error("A dependent field operation lost its key or error contract.");
      predicates.push({ kind: "type", type: owner, bounds: [{ kind: "trait-type", reference: {
        trait: { kind: "named", path: access === "read" ? "rt::ReadField" : "rt::WriteField", genericArguments: [
          { kind: "type", type: keyType }, { kind: "type", type: errorType },
        ] },
      } }] });
    }
    if (selected.requirements.length > 0) predicates.push({ kind: "type", type,
      bounds: rustGenericRequirementBounds(selected.requirements),
    });
  }
  return Object.freeze(predicates);
}

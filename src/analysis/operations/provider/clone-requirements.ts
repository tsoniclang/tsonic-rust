import type { Node } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../policy/operations/contracts.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourceTypeFamilyRegistry } from "../../../target-model/types/type-families.js";
import { createRustOptionalStorageCollector } from "../../declarations/type-projections.js";
import { createRustAssociatedRequirementCollector } from "../../declarations/associated-requirements.js";
import { classifyCarrierRequirements } from "../../declarations/generic-carrier-requirements.js";
import type { RustGenericRequirement } from "../../declarations/generic-requirements.js";

export function canRequireSourceClone(
  carrier: TargetTypeRef,
  expression: Node,
  context: RustOperationPolicyContext,
  families: RustSourceTypeFamilyRegistry,
): boolean {
  const parameters = new Set<string>();
  for (let owner: Node | undefined = expression; owner !== undefined; owner = context.ast.parent(owner)) {
    const contract = context.sourceLifetimes.contractFor(owner);
    for (const parameter of contract?.parameters ?? []) {
      if (parameter.kind === "type") parameters.add(parameter.identity);
    }
  }
  const requirements = new Map([...parameters].map(identity => [identity, new Set<RustGenericRequirement>()] as const));
  const storage = createRustOptionalStorageCollector(parameters, parameters, requirements);
  if (!storage.collect(carrier)) return false;
  const classify = (type: TargetTypeRef, required: readonly RustGenericRequirement[]): boolean =>
    classifyCarrierRequirements(type, required, parameters, requirements, associated.require, context.typeDefinitions);
  const associated = createRustAssociatedRequirementCollector(parameters, families, classify);
  return associated.collect(carrier) && classify(carrier, ["clone"]);
}

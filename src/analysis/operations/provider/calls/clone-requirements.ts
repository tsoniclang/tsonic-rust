import type { Node } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustCarrierSupportsTrait } from "../../../../target-model/types/index.js";

export function canRequireSourceClone(
  carrier: TargetTypeRef,
  expression: Node,
  context: RustOperationPolicyContext,
): boolean {
  const parameters = new Set<string>();
  for (let owner: Node | undefined = expression; owner !== undefined; owner = context.ast.parent(owner)) {
    const contract = context.sourceLifetimes.contractFor(owner);
    for (const parameter of contract?.parameters ?? []) {
      if (parameter.kind === "type") parameters.add(parameter.sourceName);
    }
  }
  return rustCarrierSupportsTrait(carrier, "core::clone::Clone", (name, trait) =>
    trait === "core::clone::Clone" && parameters.has(name));
}

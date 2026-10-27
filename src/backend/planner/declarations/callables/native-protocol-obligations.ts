import type { RustNativeCallableProtocol } from "../../../../target-model/records/native/native-protocols.js";
import type { RustWherePredicate } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

// Each associated projection in the protocol signature requires its owner to implement the projected trait.
export function planRustNativeProtocolObligations(protocol: RustNativeCallableProtocol, context: RustPlanContext): readonly RustWherePredicate[] {
  return protocol.associatedObligations.map(obligation => {
    const owner = rustTypeFromCarrierInContext(obligation.owner, context);
    const trait = rustTypeFromCarrierInContext(obligation.trait, context);
    if (owner === undefined || trait === undefined)
      failRustPlannerInvariant("An admitted native callable protocol requires its rendered associated obligations.");
    return { kind: "type" as const, type: owner, bounds: [{ kind: "trait-type" as const, reference: { trait } }] };
  });
}

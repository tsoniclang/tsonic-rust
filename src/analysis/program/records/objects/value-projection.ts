import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustProjectUpcastFact } from "../../../../target-model/records/objects/value-projections.js";
import type { RustValueProjection, RustProjectUpcastEmission } from "../../../../target-model/records/objects/value-projection.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function createRustValueProjectionProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, ReadonlyMap<string, RustValueProjection>>();
  // An expression without value transitions reads identically at any carrier the planner substitutes for it (for example
  // a receiver re-bound to an inherited owner's instantiation), so its one projection answers every carrier.
  const carrierIndependent = new WeakSet<Node>();
  const upcasts = new Map<string, RustProjectUpcastEmission>();
  const key = (carrier: TargetTypeRef | undefined): string => carrier === undefined ? "default" : closedMetadataKey(carrier);
  return Object.freeze({ records: Object.freeze({
    valueProjection: Object.freeze({ get: (node: Node, carrier?: TargetTypeRef) =>
      values.get(node)?.get(carrierIndependent.has(node) ? "default" : key(carrier)) }),
    projectUpcastEmission: Object.freeze({ get: (fact: RustProjectUpcastFact) => upcasts.get(closedMetadataKey(fact)) }),
  }), publish(node: Node, plans: readonly { readonly carrier: TargetTypeRef | undefined; readonly value: RustValueProjection }[],
    independent: boolean): void {
    assertOpen();
    if (values.has(node)) failTargetAnalysisInvariant("tsonic-rust", "An expression has one finalized ordered value-projection owner.", node);
    values.set(node, new Map(plans.map(plan => [key(plan.carrier), Object.freeze(plan.value)])));
    if (independent) carrierIndependent.add(node);
  }, upcast(fact: RustProjectUpcastFact, selected: RustProjectUpcastEmission): void {
    assertOpen();
    const identity = closedMetadataKey(fact);
    if (upcasts.has(identity)) failTargetAnalysisInvariant("tsonic-rust", "A native upcast has one exact heritage and storage owner.");
    upcasts.set(identity, Object.freeze(selected));
  } });
}

export type RustValueProjectionProducer = ReturnType<typeof createRustValueProjectionProducer>;

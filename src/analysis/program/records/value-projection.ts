import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectUpcastFact } from "../../../target-model/records/value-projections.js";
import type { RustValueProjection, RustProjectUpcastEmission } from "../../../target-model/records/value-projection.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

export function createRustValueProjectionProducer(assertOpen: () => void) {
  const values = new WeakMap<Node, ReadonlyMap<string, RustValueProjection>>();
  const upcasts = new Map<string, RustProjectUpcastEmission>();
  const key = (carrier: TargetTypeRef | undefined): string => carrier === undefined ? "default" : closedMetadataKey(carrier);
  return Object.freeze({ records: Object.freeze({
    valueProjection: Object.freeze({ get: (node: Node, carrier?: TargetTypeRef) => values.get(node)?.get(key(carrier)) }),
    projectUpcastEmission: Object.freeze({ get: (fact: RustProjectUpcastFact) => upcasts.get(closedMetadataKey(fact)) }),
  }), publish(node: Node, plans: readonly { readonly carrier: TargetTypeRef | undefined; readonly value: RustValueProjection }[]): void {
    assertOpen();
    if (values.has(node)) failTargetAnalysisInvariant("tsonic-rust", "An expression has one finalized ordered value-projection owner.", node);
    values.set(node, new Map(plans.map(plan => [key(plan.carrier), Object.freeze(plan.value)])));
  }, upcast(fact: RustProjectUpcastFact, selected: RustProjectUpcastEmission): void {
    assertOpen();
    const identity = closedMetadataKey(fact);
    if (upcasts.has(identity)) failTargetAnalysisInvariant("tsonic-rust", "A native upcast has one exact heritage and storage owner.");
    upcasts.set(identity, Object.freeze(selected));
  } });
}

export type RustValueProjectionProducer = ReturnType<typeof createRustValueProjectionProducer>;

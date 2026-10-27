import type { Node } from "@tsonic/tsts";
import { maximumRustFoundation, type RustFoundation } from "../../../../target-model/foundation/model.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustDeferredProducerEffectsFact } from "../../../../target-model/records/errors/deferred-producer-effects.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { rustFoundationForCarrier } from "../../../foundation/requirements.js";
import { createRustRecordFamily } from "../family.js";

export interface RustDeferredProducerEffectsProducer {
  readonly records: RustRecordFamily<RustDeferredProducerEffectsFact>;
  finalize(completed: ReadonlyMap<Node, RustDeferredProducerEffectsFact>): void;
}

export function createRustDeferredProducerEffectsProducer(
  assertOpen: () => void,
  requireFoundation: (foundation: RustFoundation) => void,
  inherited?: RustDeferredProducerEffectsProducer["records"],
): RustDeferredProducerEffectsProducer {
  const family = createRustRecordFamily<RustDeferredProducerEffectsFact>({
    id: "tsonic.rust.deferredProducerEffects", equals: closedMetadataEquals,
  }, assertOpen, inherited, fact => requireFoundation(fact.kind === "no-future" ? "core"
    : fact.channels.reduce<RustFoundation>((foundation, channel) => maximumRustFoundation(foundation,
      rustFoundationForCarrier(channel.errorCarrier)), "core")));
  return Object.freeze({
    records: family.reader,
    finalize(completed: ReadonlyMap<Node, RustDeferredProducerEffectsFact>): void {
      assertOpen();
      for (const [subject, selection] of completed) family.writer.set(subject, selection);
    },
  });
}

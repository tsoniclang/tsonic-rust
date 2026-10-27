import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import type { RustDeferredProducerChannel } from "../../../target-model/records/errors/deferred-producer-effects.js";

export function mergeRustDeferredProducerChannels(
  channels: readonly RustDeferredProducerChannel[],
): RustDeferredProducerChannel | undefined {
  const selected = channels[0];
  return selected !== undefined && channels.every(channel => closedMetadataEquals(selected, channel)) ? selected : undefined;
}

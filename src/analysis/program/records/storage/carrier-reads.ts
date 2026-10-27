import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustCarrierReadEmission, RustCarrierReadRecords } from "../../../../target-model/records/storage/carrier-reads.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export interface RustCarrierReadProducer {
  readonly records: RustCarrierReadRecords;
  carrier(carrier: TargetTypeRef, value: RustCarrierReadEmission): void;
}

export function createRustCarrierReadProducer(assertOpen: () => void): RustCarrierReadProducer {
  const values = new Map<string, RustCarrierReadEmission>();
  return Object.freeze({ records: Object.freeze({ carrierRead: Object.freeze({ get: (carrier: TargetTypeRef) => values.get(closedMetadataKey(carrier)) }) }),
    carrier(carrier: TargetTypeRef, value: RustCarrierReadEmission): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (values.has(key)) failTargetAnalysisInvariant("tsonic-rust", "An exact native carrier read has one source producer.");
      values.set(key, Object.freeze(value));
    },
  });
}

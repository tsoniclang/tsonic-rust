import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustTypeEmission, RustTypeEmissionRecords } from "../../../../target-model/records/types/type-emission.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export interface RustTypeEmissionProducer {
  readonly records: RustTypeEmissionRecords;
  publish(carrier: TargetTypeRef, value: RustTypeEmission): void;
}

export function createRustTypeEmissionProducer(assertOpen: () => void): RustTypeEmissionProducer {
  const values = new Map<string, RustTypeEmission>();
  return Object.freeze({ records: Object.freeze({ typeEmission: Object.freeze({ get: (carrier: TargetTypeRef) => values.get(closedMetadataKey(carrier)) }) }),
    publish(carrier: TargetTypeRef, value: RustTypeEmission): void {
      assertOpen();
      const key = closedMetadataKey(carrier);
      if (values.has(key)) failTargetAnalysisInvariant("tsonic-rust", "A native type has one exact pre-seal rendering and position owner.");
      values.set(key, Object.freeze(value));
    },
  });
}

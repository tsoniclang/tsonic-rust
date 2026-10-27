import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustValueConversion } from "../../../../target-model/operations/model.js";
import type { RustValueConversionContract } from "../../../../target-model/conversions/contracts.js";
import type { RustConversionEmissionRecords } from "../../../../target-model/records/operations/conversion-emission.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function createRustConversionEmissionProducer(assertOpen: () => void) {
  const values = new Map<string, RustValueConversionContract>();
  const records: RustConversionEmissionRecords = Object.freeze({ conversionContract: Object.freeze({
    get: (conversion: RustValueConversion) => values.get(closedMetadataKey(conversion)),
  }) });
  return Object.freeze({ records, publish(conversion: RustValueConversion, value: RustValueConversionContract): void {
    assertOpen();
    const key = closedMetadataKey(conversion);
    if (values.has(key)) failTargetAnalysisInvariant("tsonic-rust", "An exact native value conversion has one pre-seal emission owner.");
    values.set(key, Object.freeze(value));
  } });
}

export type RustConversionEmissionProducer = ReturnType<typeof createRustConversionEmissionProducer>;

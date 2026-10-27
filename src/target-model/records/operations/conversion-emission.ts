import type { RustValueConversion } from "../../operations/model.js";
import type { RustValueConversionContract } from "../../conversions/contracts.js";

export interface RustConversionEmissionRecords {
  readonly conversionContract: { readonly get: (conversion: RustValueConversion) => RustValueConversionContract | undefined };
}

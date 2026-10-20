import type { SourcePrimitiveKind } from "@tsonic/tsts";
import type { RustValueConversionContract } from "../../target-model/conversions/contracts.js";
import type { RustFinalizedOperationKind, RustProviderOperationForm, RustValueConversion } from "../../target-model/operations/model.js";

export interface RustProviderContractValidation {
  readonly conversion: (conversion: RustValueConversion) => RustValueConversionContract | undefined;
  readonly numericPromotion: (source: SourcePrimitiveKind, target: SourcePrimitiveKind) => boolean;
  readonly operation: (kind: RustFinalizedOperationKind, form: RustProviderOperationForm, argumentCount: number) => string | undefined;
}

import type { RustProviderContractValidation } from "../model/contract-validation.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { rustNumericPromotionKind } from "../../policy/conversions/numeric-promotion.js";
import { rustProviderOperationFormContractViolation } from "../../policy/operations/forms.js";

export const rustProviderContractValidation: RustProviderContractValidation = Object.freeze({
  conversion: rustValueConversionContract,
  numericPromotion: (source: SourcePrimitiveKind, target: SourcePrimitiveKind) => rustNumericPromotionKind(source, target) !== undefined,
  operation: rustProviderOperationFormContractViolation,
});
import type { SourcePrimitiveKind } from "@tsonic/tsts";

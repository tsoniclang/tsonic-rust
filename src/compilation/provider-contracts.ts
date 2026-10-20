import type { RustProviderContractValidation } from "../providers/model/contract-validation.js";
import { rustValueConversionContract } from "../policy/conversions/contracts.js";
import { rustNumericPromotionKind } from "../policy/conversions/numeric-promotion.js";
import { rustProviderOperationFormContractViolation } from "../policy/operations/forms.js";

export const rustProviderContractValidation: RustProviderContractValidation = Object.freeze({
  conversion: rustValueConversionContract,
  numericPromotion: (source, target) => rustNumericPromotionKind(source, target) !== undefined,
  operation: rustProviderOperationFormContractViolation,
});

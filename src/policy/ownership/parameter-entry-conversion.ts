import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustIntegerKindIsExactlyRepresentableAsFloat64 } from "../../target-model/conversions/numeric-promotion.js";
import { selectRustSourceValueConversion } from "../conversions/selection.js";

export function selectRustParameterEntryConversion(
  parameter: TargetTypeRef,
  value: TargetTypeRef,
  definitions: RustTypeDefinitions,
): RustValueConversion | undefined {
  const conversion = selectRustSourceValueConversion(parameter, value, definitions);
  const contract = conversion === undefined ? undefined : rustValueConversionContract(conversion, definitions);
  const exactFloat = value.kind === "source-primitive" && parameter.kind === "source-primitive" &&
    value.name === "float64" && (parameter.name === "float32" ||
      rustIntegerKindIsExactlyRepresentableAsFloat64(parameter.name));
  return conversion !== undefined && contract !== undefined && contract.sourceMode === "value" &&
    !contract.fallible && (contract.category === "exact" || exactFloat) ? conversion : undefined;
}

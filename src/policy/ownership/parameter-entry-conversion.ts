import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustParameterEntryConversion } from "../../target-model/records/callables/callables-and-resources.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustValueConversionContract } from "../conversions/contracts.js";
import { rustIntegerKindIsExactlyRepresentableAsFloat64 } from "../conversions/numeric-promotion.js";
import { selectRustSourceValueConversion } from "../conversions/selection.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";

export function selectRustParameterEntryConversion(
  parameter: TargetTypeRef,
  value: TargetTypeRef,
  definitions: RustTypeDefinitions,
): RustParameterEntryConversion | undefined {
  const conversion = selectRustSourceValueConversion(parameter, value, definitions);
  const contract = conversion === undefined ? undefined : rustValueConversionContract(conversion, definitions);
  const exactFloat = value.kind === "source-primitive" && parameter.kind === "source-primitive" &&
    value.name === "float64" && (parameter.name === "float32" ||
      rustIntegerKindIsExactlyRepresentableAsFloat64(parameter.name));
  return conversion !== undefined && contract !== undefined && contract.sourceMode === "value" &&
    !contract.fallible && (contract.category === "exact" || exactFloat) ? snapshotClosedMetadata({ conversion, contract }) : undefined;
}

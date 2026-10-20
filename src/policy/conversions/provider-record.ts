import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue, rustCarrierSupportsClone, rustNamedTypeCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";

import { rustProviderRecordAbsentFieldsMatch } from "../../target-model/conversions/provider-record-absence.js";

import type { RustProviderRecordCopy } from "../../target-model/conversions/provider-record.js";
export function rustProviderRecordCopyMatches(
  conversion: RustProviderRecordCopy,
  source: TargetTypeRef,
  target: TargetTypeRef,
  definitions: RustTypeDefinitions = emptyRustTypeDefinitions,
): boolean {
  const shape = rustStructuralObjectCarrierValue(source);
  return shape !== undefined && rustNamedTypeCarrierValue(target) !== undefined &&
    rustTargetTypeRefEquals(source, conversion.source) &&
    rustTargetTypeRefEquals(target, conversion.target) &&
    (conversion.completion === "complete" || conversion.completion === "default") &&
    rustProviderRecordAbsentFieldsMatch(conversion.absentFields) &&
    (conversion.completion !== "default" || conversion.absentFields.length === 0) &&
    new Set([...conversion.fields, ...conversion.absentFields].map(field => field.targetName)).size ===
      conversion.fields.length + conversion.absentFields.length &&
    conversion.fields.every(field => {
      const sourceField = shape.fields[field.storageIndex];
      const contract = field.conversion === undefined
        ? undefined : rustValueConversionContract(field.conversion, definitions);
      const exactConversion = contract !== undefined && rustTargetTypeRefEquals(contract.source, field.sourceCarrier) &&
          rustTargetTypeRefEquals(contract.target, field.carrier);
      return Number.isSafeInteger(field.storageIndex) && field.storageIndex >= 0 &&
        typeof field.targetName === "string" && field.targetName.length > 0 &&
        sourceField !== undefined && sourceField.presence === "required" &&
        sourceField.accessor === undefined && sourceField.method !== true &&
        rustTargetTypeRefEquals(sourceField.type, field.sourceCarrier) &&
        (field.conversion === undefined ? rustTargetTypeRefEquals(field.sourceCarrier, field.carrier) : exactConversion) &&
        rustCarrierSupportsClone(field.sourceCarrier, definitions);
    });
}

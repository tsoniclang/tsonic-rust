import type { TargetTypeRef } from "../types/model.js";
import { rustStructuralObjectCarrierValue, rustCarrierSupportsClone, rustNamedTypeCarrierValue } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../types/source-union-definitions.js";
import { rustValueConversionContract } from "./contracts.js";
import type { RustValueConversion } from "../operations/model.js";
import { rustProviderRecordAbsentFieldsMatch, type RustProviderRecordAbsentField } from "./provider-record-absence.js";

export interface RustProviderRecordCopy {
  readonly kind: "provider-record-copy";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly completion: "complete" | "default";
  readonly absentFields: readonly RustProviderRecordAbsentField[];
  readonly fields: readonly {
    readonly storageIndex: number;
    readonly sourceCarrier: TargetTypeRef;
    readonly carrier: TargetTypeRef;
    readonly targetName: string;
    readonly conversion?: RustValueConversion;
  }[];
}

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

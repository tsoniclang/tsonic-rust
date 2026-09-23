import type { TargetTypeRef } from "../types/model.js";
import { rustStructuralObjectCarrierValue, rustCarrierSupportsClone, rustNamedTypeCarrierValue } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";
import { emptyRustTypeDefinitions, type RustTypeDefinitions } from "../types/source-union-definitions.js";
import { rustExactIntegerConversionMatches, type RustExactIntegerConversion } from "./exact-integer.js";
import { rustValueConversionContract } from "./contracts.js";
import type { RustValueConversion } from "../operations/model.js";

export interface RustProviderRecordCopy {
  readonly kind: "provider-record-copy";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly completion: "complete" | "default";
  readonly fields: readonly {
    readonly storageIndex: number;
    readonly sourceCarrier: TargetTypeRef;
    readonly carrier: TargetTypeRef;
    readonly targetName: string;
    readonly conversion?: RustExactIntegerConversion | RustValueConversion;
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
    new Set(conversion.fields.map(field => field.targetName)).size === conversion.fields.length &&
    conversion.fields.every(field => {
      const sourceField = shape.fields[field.storageIndex];
      const contract = field.conversion === undefined || field.conversion.kind === "exact-integer"
        ? undefined : rustValueConversionContract(field.conversion, definitions);
      const exactConversion = field.conversion?.kind === "exact-integer"
        ? rustExactIntegerConversionMatches(field.sourceCarrier, field.carrier, field.conversion)
        : contract !== undefined && rustTargetTypeRefEquals(contract.source, field.sourceCarrier) &&
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

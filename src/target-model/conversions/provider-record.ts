import type { TargetTypeRef } from "../types/model.js";
import { rustStructuralObjectCarrierValue, rustCarrierSupportsClone, rustNamedTypeCarrierValue } from "../types/index.js";
import { rustTargetTypeRefEquals } from "../types/equality.js";

export interface RustProviderRecordCopy {
  readonly kind: "provider-record-copy";
  readonly source: TargetTypeRef;
  readonly target: TargetTypeRef;
  readonly completion: "complete" | "default";
  readonly fields: readonly {
    readonly storageIndex: number;
    readonly carrier: TargetTypeRef;
    readonly targetName: string;
  }[];
}

export function rustProviderRecordCopyMatches(
  conversion: RustProviderRecordCopy,
  source: TargetTypeRef,
  target: TargetTypeRef,
): boolean {
  const shape = rustStructuralObjectCarrierValue(source);
  return shape !== undefined && rustNamedTypeCarrierValue(target) !== undefined &&
    rustTargetTypeRefEquals(source, conversion.source) &&
    rustTargetTypeRefEquals(target, conversion.target) &&
    (conversion.completion === "complete" || conversion.completion === "default") &&
    new Set(conversion.fields.map(field => field.targetName)).size === conversion.fields.length &&
    conversion.fields.every(field => {
      const sourceField = shape.fields[field.storageIndex];
      return Number.isSafeInteger(field.storageIndex) && field.storageIndex >= 0 &&
        typeof field.targetName === "string" && field.targetName.length > 0 &&
        sourceField !== undefined && sourceField.presence === "required" &&
        sourceField.accessor === undefined && sourceField.method !== true &&
        rustTargetTypeRefEquals(sourceField.type, field.carrier) &&
        rustCarrierSupportsClone(field.carrier);
    });
}

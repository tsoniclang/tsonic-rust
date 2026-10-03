import { rustStructuralObjectCarrierValue, rustStructuralMethodStorageCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustCopiedMethodReceiverIsPreserved(
  source: TargetTypeRef,
  sourceIndex: number,
  destination: TargetTypeRef,
  destinationIndex: number,
): boolean {
  if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 ||
    !Number.isSafeInteger(destinationIndex) || destinationIndex < 0) return false;
  const sourceField = rustStructuralObjectCarrierValue(source)?.fields[sourceIndex];
  const destinationField = rustStructuralObjectCarrierValue(destination)?.fields[destinationIndex];
  if (sourceField?.method !== true || destinationField?.method !== true) return false;
  const sourceStorage = rustStructuralMethodStorageCarrier(source, sourceField.type, sourceField.presence);
  const destinationStorage = rustStructuralMethodStorageCarrier(destination, destinationField.type, destinationField.presence);
  return sourceStorage !== undefined && destinationStorage !== undefined &&
    rustTargetTypeRefEquals(sourceStorage, destinationStorage);
}

import type { RustTargetGenericArgument, TargetTypeRef } from "../model.js";
import { hasExactObjectKeys, isDenseDataArray, snapshotClosedMetadata } from "../../metadata/closed-data.js";
import { isRustTargetGenericArgument } from "../equality.js";

export interface RustProducerErrorReference {
  readonly identity: string;
  readonly fileName: string;
  readonly channel: "invoke" | number;
  readonly genericArguments: readonly RustTargetGenericArgument[];
}

export function rustProducerErrorTargetType(reference: RustProducerErrorReference): TargetTypeRef {
  return snapshotClosedMetadata({ kind: "target-specific", target: "rust", name: "producer-error", value: reference });
}

export function rustProducerErrorReference(type: TargetTypeRef | undefined): RustProducerErrorReference | undefined {
  if (type?.kind !== "target-specific" || type.target !== "rust" || type.name !== "producer-error") return undefined;
  const value = type.value as Partial<RustProducerErrorReference> | undefined;
  return value === undefined || value === null || typeof value !== "object" ||
    !hasExactObjectKeys(value, ["identity", "fileName", "channel", "genericArguments"]) ||
    typeof value.identity !== "string" || value.identity.length === 0 ||
    typeof value.fileName !== "string" || value.fileName.length === 0 ||
    value.channel !== "invoke" && (!Number.isSafeInteger(value.channel) || (value.channel as number) < 0) ||
    !isDenseDataArray(value.genericArguments) || !value.genericArguments.every(isRustTargetGenericArgument)
    ? undefined : value as RustProducerErrorReference;
}

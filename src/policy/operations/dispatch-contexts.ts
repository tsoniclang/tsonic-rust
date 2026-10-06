import { hasExactObjectKeys, isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { RustDispatchContextInput, RustResolvedDispatchContextInput } from "../../target-model/operations/dispatch-contexts.js";
import { isRustTargetTypeRef } from "../../target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../target-model/types/index.js";

export function isRustDispatchContextInput(value: unknown): value is RustDispatchContextInput {
  if (!isClosedMetadata(value) || typeof value !== "object" || value === null ||
    Array.isArray(value) || !hasExactObjectKeys(value, ["contextId", "view", "targetArgumentIndex", "mode"])) {
    return false;
  }
  const input = value as Readonly<Record<string, unknown>>;
  return typeof input.contextId === "string" && input.contextId.length > 0 &&
    (input.view === "root" || input.view === "handle") &&
    typeof input.targetArgumentIndex === "number" && Number.isSafeInteger(input.targetArgumentIndex) &&
    input.targetArgumentIndex >= 0 && (input.mode === "ref" || input.view === "handle" && input.mode === "value");
}

export function isRustResolvedDispatchContextInput(value: unknown): value is RustResolvedDispatchContextInput {
  if (!isClosedMetadata(value) || typeof value !== "object" || value === null ||
    Array.isArray(value) || !hasExactObjectKeys(value, ["contextId", "view", "targetArgumentIndex", "mode", "carrier"])) {
    return false;
  }
  const input = value as Readonly<Record<string, unknown>>;
  const { carrier, ...request } = input;
  return isRustDispatchContextInput(request) && isRustTargetTypeRef(carrier) &&
    (carrier.kind === "target-named" || rustNamedTypeCarrierValue(carrier) !== undefined);
}

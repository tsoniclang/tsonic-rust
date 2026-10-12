import type { RustTargetGenericArgument } from "../model.js";
import { isRustTargetGenericArgument } from "../equality.js";
import { hasExactObjectKeys, isDenseDataArray, closedMetadataKey } from "../../metadata/closed-data.js";
import { isRustCallableOrigin, type RustCallableOrigin } from "./callable-signatures.js";

export interface RustGenericCallableStorageMember {
  readonly origin: RustCallableOrigin;
  readonly arguments: readonly RustTargetGenericArgument[];
}

export interface RustGenericCallableStorage {
  readonly ownerFileName: string;
  readonly members: readonly RustGenericCallableStorageMember[];
}

export function isRustGenericCallableStorage(value: unknown): value is RustGenericCallableStorage {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !hasExactObjectKeys(value, ["ownerFileName", "members"])) return false;
  const selected = value as Partial<RustGenericCallableStorage>;
  if (typeof selected.ownerFileName !== "string" || selected.ownerFileName.length === 0 ||
    !isDenseDataArray(selected.members) || selected.members.length === 0) return false;
  let previous: string | undefined;
  for (const member of selected.members) {
    if (typeof member !== "object" || member === null || Array.isArray(member) ||
      !hasExactObjectKeys(member, ["origin", "arguments"]) || !isRustCallableOrigin(member.origin) ||
      !isDenseDataArray(member.arguments) || !member.arguments.every(isRustTargetGenericArgument)) return false;
    const identity = closedMetadataKey(member);
    if (previous !== undefined && previous >= identity) return false;
    previous = identity;
  }
  return true;
}

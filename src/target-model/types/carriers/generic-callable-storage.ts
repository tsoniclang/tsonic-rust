import type { RustTargetGenericArgument, TargetTypeRef } from "../model.js";
import { isRustTargetGenericArgument } from "../equality.js";
import { hasExactObjectKeys, isDenseDataArray, closedMetadataKey } from "../../metadata/closed-data.js";
import { isRustCallableOrigin, type RustCallableOrigin } from "./callable-signatures.js";

export interface RustGenericCallableStorageMember {
  readonly origin: RustCallableOrigin;
  readonly arguments: readonly number[];
}

export interface RustGenericCallableStorage {
  readonly ownerFileName: string;
  readonly members: readonly RustGenericCallableStorageMember[];
  readonly arguments: readonly RustTargetGenericArgument[];
}

export function rustGenericCallableStorageArguments(
  environment: readonly TargetTypeRef[],
  physical: readonly RustTargetGenericArgument[],
): readonly RustTargetGenericArgument[] {
  return Object.freeze([
    ...physical.filter(argument => argument.kind === "lifetime"),
    ...environment.map(type => ({ kind: "type" as const, type })),
    ...physical.filter(argument => argument.kind !== "lifetime"),
  ]);
}

export function isRustGenericCallableStorage(value: unknown): value is RustGenericCallableStorage {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    !hasExactObjectKeys(value, ["ownerFileName", "members", "arguments"])) return false;
  const selected = value as Partial<RustGenericCallableStorage>;
  if (typeof selected.ownerFileName !== "string" || selected.ownerFileName.length === 0 ||
    !isDenseDataArray(selected.members) || selected.members.length === 0 ||
    !isDenseDataArray(selected.arguments) || !selected.arguments.every(isRustTargetGenericArgument)) return false;
  const identities = new Set<string>();
  const indexes = new Set<number>();
  for (const member of selected.members) {
    if (typeof member !== "object" || member === null || Array.isArray(member) ||
      !hasExactObjectKeys(member, ["origin", "arguments"]) || !isRustCallableOrigin(member.origin) ||
      !isDenseDataArray(member.arguments) || !member.arguments.every(index => typeof index === "number" &&
        Number.isSafeInteger(index) && index >= 0 && index < selected.arguments!.length)) return false;
    const identity = closedMetadataKey(member);
    if (identities.has(identity)) return false;
    identities.add(identity);
    for (const index of member.arguments) indexes.add(index as number);
  }
  return indexes.size === selected.arguments.length;
}

import type { ProviderExportDeclaration } from "@tsonic/tsts";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";

export function refineNativeExportDeclaration(
  existing: ProviderExportDeclaration | undefined,
  incoming: ProviderExportDeclaration,
  wasComplete: boolean,
  isComplete: boolean,
): ProviderExportDeclaration {
  if (!isComplete && (incoming.members?.length ?? 0) !== 0) {
    throw new Error(`Rust incomplete declaration '${incoming.id}' contains members.`);
  }
  if (existing === undefined) return incoming;
  const { members: previousMembers, ...previousHeader } = existing;
  const { members: incomingMembers, ...incomingHeader } = incoming;
  if (closedMetadataKey(previousHeader) !== closedMetadataKey(incomingHeader) ||
    wasComplete && isComplete && closedMetadataKey(previousMembers ?? []) !== closedMetadataKey(incomingMembers ?? [])) {
    throw new Error(`Rust compiler-provider export '${incoming.id}' has conflicting projections.`);
  }
  return wasComplete ? existing : incoming;
}

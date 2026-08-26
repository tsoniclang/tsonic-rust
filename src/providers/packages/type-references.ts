import type {
  RustGenericArgument,
  RustSemanticIdentity,
} from "../../target-model/semantics/index.js";
import { rustPathTargetType } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustProviderBindingProviderId } from "./identity.js";

export interface RustProviderTypeOwner {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly compilationSnapshotId: string;
}

export function rustProviderTypeIdentity(
  owner: RustProviderTypeOwner,
  itemId: string,
): RustSemanticIdentity {
  if (owner.packageId.length === 0 || owner.packageVersion.length === 0 ||
    owner.compilationSnapshotId.length === 0 || itemId.length === 0) {
    throw new Error("Rust provider type identities require exact package, version, compilation-snapshot, and item identities.");
  }
  return Object.freeze({
    kind: "provider",
    providerId: rustProviderBindingProviderId(owner.packageId),
    providerVersion: owner.packageVersion,
    compilationSnapshotId: owner.compilationSnapshotId,
    itemId,
  });
}

export function rustProviderPathTargetType(options: {
  readonly owner: RustProviderTypeOwner;
  readonly itemId: string;
  readonly displayPath: string;
  readonly arguments?: readonly RustGenericArgument[];
}): TargetTypeRef {
  if (options.owner.packageId.length === 0 || options.owner.packageVersion.length === 0 ||
    options.owner.compilationSnapshotId.length === 0 || options.itemId.length === 0 ||
    options.displayPath.length === 0) {
    throw new Error("Rust provider path types require exact package, version, compilation-snapshot, item, and display-path identities.");
  }
  return rustPathTargetType({
    identity: rustProviderTypeIdentity(options.owner, options.itemId),
    displayPath: Object.freeze(options.displayPath.split("::")),
    arguments: options.arguments,
  });
}

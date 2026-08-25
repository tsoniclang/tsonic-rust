import type {
  RustGenericArgument,
  RustTraitImplementationEvidence,
} from "../../target-model/semantics/index.js";
import { rustPathTargetType } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustProviderBindingProviderId } from "./identity.js";

export interface RustProviderTypeOwner {
  readonly packageId: string;
  readonly packageVersion: string;
}

export function rustProviderPathTargetType(options: {
  readonly owner: RustProviderTypeOwner;
  readonly itemId: string;
  readonly displayPath: string;
  readonly arguments?: readonly RustGenericArgument[];
  readonly traitImplementations?: readonly RustTraitImplementationEvidence[];
}): TargetTypeRef {
  if (options.owner.packageId.length === 0 || options.owner.packageVersion.length === 0 ||
    options.itemId.length === 0 || options.displayPath.length === 0) {
    throw new Error("Rust provider path types require exact package, version, item, and display-path identities.");
  }
  return rustPathTargetType({
    identity: Object.freeze({
      kind: "provider",
      providerId: rustProviderBindingProviderId(options.owner.packageId),
      providerVersion: options.owner.packageVersion,
      compilationSnapshotId: `${options.owner.packageId}@${options.owner.packageVersion}`,
      itemId: options.itemId,
    }),
    displayPath: Object.freeze(options.displayPath.split("::")),
    arguments: options.arguments,
    traitImplementations: options.traitImplementations,
  });
}

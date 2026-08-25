export type RustSemanticIdentity =
  | {
      readonly kind: "builtin";
      readonly namespace: "rust" | "tsonic-runtime";
      readonly itemId: string;
    }
  | {
      readonly kind: "provider";
      readonly providerId: string;
      readonly providerVersion?: string;
      readonly compilationSnapshotId: string;
      readonly itemId: string;
    }
  | {
      readonly kind: "project";
      readonly packageId: string;
      readonly sourceFileId: string;
      readonly declarationId: string;
    }
  | {
      readonly kind: "generated";
      readonly artifactId: string;
      readonly itemId: string;
    };

export function rustBuiltinIdentity(
  itemId: string,
  namespace: "rust" | "tsonic-runtime" = "rust",
): RustSemanticIdentity {
  return Object.freeze({ kind: "builtin", namespace, itemId });
}

export function rustSemanticIdentityKey(identity: RustSemanticIdentity): string {
  switch (identity.kind) {
    case "builtin":
      return `builtin\0${identity.namespace}\0${identity.itemId}`;
    case "provider":
      return [
        "provider",
        identity.providerId,
        identity.providerVersion === undefined ? "version:none" : `version:${identity.providerVersion}`,
        identity.compilationSnapshotId,
        identity.itemId,
      ].join("\0");
    case "project":
      return [
        "project",
        identity.packageId,
        identity.sourceFileId,
        identity.declarationId,
      ].join("\0");
    case "generated":
      return `generated\0${identity.artifactId}\0${identity.itemId}`;
  }
}

export function rustSemanticIdentityItemId(
  identity: RustSemanticIdentity,
): string | undefined {
  switch (identity.kind) {
    case "builtin":
    case "provider":
    case "generated":
      return identity.itemId;
    case "project":
      return undefined;
  }
}

export function rustSemanticIdentitiesEqual(
  left: RustSemanticIdentity,
  right: RustSemanticIdentity,
): boolean {
  return rustSemanticIdentityKey(left) === rustSemanticIdentityKey(right);
}

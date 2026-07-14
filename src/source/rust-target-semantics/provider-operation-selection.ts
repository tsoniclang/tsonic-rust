import type {
  ProviderDeclarationIdentity,
} from "@tsonic/tsts";
import type {
  RustProviderOperationRow,
} from "../provider-packages/index.js";

export type RustProviderOperationSelection =
  | { readonly kind: "selected"; readonly row: RustProviderOperationRow }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly rows: readonly RustProviderOperationRow[] };

export function rustProviderOperationOwnerMatches(
  row: RustProviderOperationRow,
  identity: ProviderDeclarationIdentity,
): boolean {
  return row.providerId === identity.providerId &&
    row.providerVersion === identity.providerVersion &&
    row.providerModuleId === identity.providerModuleId &&
    row.moduleSpecifier === identity.moduleSpecifier;
}

export function selectRustProviderOperation(
  rows: readonly RustProviderOperationRow[],
  identity: ProviderDeclarationIdentity,
  operationKind: RustProviderOperationRow["operationKind"],
): RustProviderOperationSelection {
  if (identity.exportId === undefined) {
    return { kind: "missing" };
  }
  const identityCandidates = rows.filter((row) =>
    rustProviderOperationOwnerMatches(row, identity) &&
    row.operationKind === operationKind &&
    row.exportId === identity.exportId &&
    row.memberId === identity.memberId);

  const exactSignatureCandidates = identity.signatureId === undefined
    ? []
    : identityCandidates.filter((row) => row.signatureId === identity.signatureId);
  if (exactSignatureCandidates.length > 0) {
    return uniqueSelection(exactSignatureCandidates);
  }

  const groupCandidates = identityCandidates.filter((row) => row.signatureId === undefined);
  return uniqueSelection(groupCandidates);
}

function uniqueSelection(rows: readonly RustProviderOperationRow[]): RustProviderOperationSelection {
  if (rows.length === 0) {
    return { kind: "missing" };
  }
  if (rows.length === 1) {
    return { kind: "selected", row: rows[0]! };
  }
  return { kind: "ambiguous", rows };
}

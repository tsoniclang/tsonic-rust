import type {
  ProviderDeclarationIdentity,
} from "@tsonic/tsts";
import type {
  RustProviderExportRow,
  RustProviderOperationRow,
} from "../provider-packages/index.js";

interface RustProviderOwnerIdentity {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export type RustProviderOperationSelection =
  | { readonly kind: "selected"; readonly row: RustProviderOperationRow }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly rows: readonly RustProviderOperationRow[] };

export type RustProviderExportSelection =
  | { readonly kind: "selected"; readonly row: RustProviderExportRow }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly rows: readonly RustProviderExportRow[] };

export function rustProviderOperationOwnerMatches(
  row: RustProviderOwnerIdentity,
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

export function selectRustProviderExport(
  rows: readonly RustProviderExportRow[],
  identity: ProviderDeclarationIdentity,
): RustProviderExportSelection {
  if (identity.exportId === undefined) {
    return { kind: "missing" };
  }
  const candidates = rows.filter((row) =>
    rustProviderOperationOwnerMatches(row, identity) &&
    row.exportId === identity.exportId);
  if (candidates.length === 0) {
    return { kind: "missing" };
  }
  if (candidates.length === 1) {
    return { kind: "selected", row: candidates[0]! };
  }
  return { kind: "ambiguous", rows: candidates };
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

import type { ProviderExportDeclaration, ProviderMemberDeclaration, ProviderSignatureDeclaration } from "@tsonic/tsts";

export type Fail = (message: string) => never;

export interface ExportRecord {
  readonly moduleSpecifier: string;
  readonly declaration: ProviderExportDeclaration;
}

export interface MemberRecord {
  readonly exportId: string;
  readonly declaration: ProviderMemberDeclaration;
}

export interface SignatureRecord {
  readonly exportId: string;
  readonly memberId?: string;
  readonly declaration: ProviderSignatureDeclaration;
}

export const rustIdentifierPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u;
export const rustPathPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*(?:::(?:r#)?[A-Za-z_][A-Za-z0-9_]*)*$/u;

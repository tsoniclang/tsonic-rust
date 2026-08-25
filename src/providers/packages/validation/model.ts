import {
  rustBigIntTargetId,
  rustBorrowedLocalCallableTargetId,
  rustBorrowedLocalAsyncCallableTargetId,
  rustBorrowedLocationTargetId,
  rustJsArrayTargetId,
  rustJsArrayConcatItemTargetId,
  rustJsDateTargetId,
  rustJsErrorTargetId,
  rustJsMapTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpIndicesTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpStringIteratorTargetId,
  rustJsRegExpTargetId,
  rustJsSetTargetId,
  rustJsStringTargetId,
  rustJsValueTargetId,
  rustNullTargetId,
  rustOptionTargetId,
  rustOwnedLocalCallableTargetId,
  rustOwnedLocalAsyncCallableTargetId,
  rustOwnedLocationTargetId,
  rustThreadedCallableTargetId,
  rustThreadedAsyncCallableTargetId,
  rustUndefinedTargetId,
  rustStringTargetId,
  rustRegExpExecArrayTargetId,
  rustRegExpIndicesTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedIndicesTargetId,
  rustRegExpStringIteratorTargetId,
} from "../../../target-model/types/index.js";
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

export const builtInTargetCarrierIds = new Set([
  rustBigIntTargetId,
  rustOwnedLocalCallableTargetId,
  rustBorrowedLocalCallableTargetId,
  rustThreadedCallableTargetId,
  rustOwnedLocalAsyncCallableTargetId,
  rustBorrowedLocalAsyncCallableTargetId,
  rustThreadedAsyncCallableTargetId,
  rustOwnedLocationTargetId,
  rustBorrowedLocationTargetId,
  rustStringTargetId,
  rustJsStringTargetId,
  rustOptionTargetId,
  rustNullTargetId,
  rustUndefinedTargetId,
  rustJsValueTargetId,
  rustJsArrayTargetId,
  rustJsArrayConcatItemTargetId,
  rustJsMapTargetId,
  rustJsSetTargetId,
  rustJsDateTargetId,
  rustJsErrorTargetId,
  rustJsRegExpTargetId,
  rustRegExpExecArrayTargetId,
  rustRegExpMatchArrayTargetId,
  rustRegExpIndicesTargetId,
  rustRegExpNamedGroupsTargetId,
  rustRegExpNamedIndicesTargetId,
  rustRegExpStringIteratorTargetId,
  rustJsRegExpExecArrayTargetId,
  rustJsRegExpMatchArrayTargetId,
  rustJsRegExpIndicesTargetId,
  rustJsRegExpNamedGroupsTargetId,
  rustJsRegExpNamedIndicesTargetId,
  rustJsRegExpStringIteratorTargetId,
]);

export const rustIdentifierPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u;
export const rustPathPattern = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*(?:::(?:r#)?[A-Za-z_][A-Za-z0-9_]*)*$/u;

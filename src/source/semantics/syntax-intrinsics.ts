import type { ProviderVirtualDeclarationFact } from "@tsonic/tsts";
import {
  rustLangModule,
  rustSourceProviderVersion,
  rustSourceSyntaxExportIds,
  rustSourceSyntaxMemberIds,
  rustSourceVirtualModulesProviderId,
} from "./identity.js";

export function isRustTokenQuotationDeclaration(declaration: ProviderVirtualDeclarationFact | undefined): boolean {
  return isSyntaxDeclaration(declaration, rustSourceSyntaxExportIds.tokens) &&
    declaration.memberId === undefined && declaration.memberName === undefined &&
    declaration.memberKey === undefined && declaration.memberStatic === undefined;
}

export function rustTokenFragmentOperation(declaration: ProviderVirtualDeclarationFact | undefined): "type" | "items" | undefined {
  if (!isSyntaxMember(declaration, rustSourceSyntaxExportIds.tokens)) return undefined;
  if (declaration.memberId === rustSourceSyntaxMemberIds.tokenType && declaration.memberName === "type") return "type";
  if (declaration.memberId === rustSourceSyntaxMemberIds.tokenItems && declaration.memberName === "items") return "items";
  return undefined;
}

export function rustNativeSelectionOperation(declaration: ProviderVirtualDeclarationFact | undefined): "macro" | "value" | undefined {
  if (!isSyntaxMember(declaration, rustSourceSyntaxExportIds.native)) return undefined;
  if (declaration.memberId === rustSourceSyntaxMemberIds.nativeMacro && declaration.memberName === "macro") return "macro";
  if (declaration.memberId === rustSourceSyntaxMemberIds.nativeValue && declaration.memberName === "value") return "value";
  return undefined;
}

function isSyntaxMember(declaration: ProviderVirtualDeclarationFact | undefined, exportId: string): declaration is ProviderVirtualDeclarationFact {
  return isSyntaxDeclaration(declaration, exportId) && declaration.memberStatic === false &&
    declaration.memberKey?.kind === "property-key" && declaration.memberKey.name === declaration.memberName;
}

function isSyntaxDeclaration(declaration: ProviderVirtualDeclarationFact | undefined, exportId: string): declaration is ProviderVirtualDeclarationFact {
  return declaration !== undefined &&
    declaration.providerId === rustSourceVirtualModulesProviderId &&
    declaration.providerVersion === rustSourceProviderVersion &&
    declaration.moduleSpecifier === rustLangModule &&
    declaration.providerModuleId === rustLangModule &&
    declaration.exportId === exportId &&
    declaration.exportName === exportId &&
    declaration.signatureId === undefined;
}

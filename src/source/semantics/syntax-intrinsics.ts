import type { ProviderVirtualDeclarationFact } from "@tsonic/tsts";
import {
  rustLangModule,
  rustSourceProviderVersion,
  rustSourceSyntaxExportIds,
  rustSourceSyntaxMemberIds,
  rustSourceVirtualModulesProviderId,
} from "./identity.js";

export function isRustTokenQuotationDeclaration(declaration: ProviderVirtualDeclarationFact | undefined): boolean {
  return isTokenSyntaxDeclaration(declaration) &&
    declaration.memberId === undefined && declaration.memberName === undefined &&
    declaration.memberKey === undefined && declaration.memberStatic === undefined;
}

export function rustTokenFragmentOperation(declaration: ProviderVirtualDeclarationFact | undefined): "type" | "items" | undefined {
  if (!isTokenSyntaxDeclaration(declaration) || declaration.memberStatic !== false ||
      declaration.memberKey?.kind !== "property-key" || declaration.memberKey.name !== declaration.memberName) return undefined;
  if (declaration.memberId === rustSourceSyntaxMemberIds.tokenType && declaration.memberName === "type") return "type";
  if (declaration.memberId === rustSourceSyntaxMemberIds.tokenItems && declaration.memberName === "items") return "items";
  return undefined;
}

function isTokenSyntaxDeclaration(declaration: ProviderVirtualDeclarationFact | undefined): declaration is ProviderVirtualDeclarationFact {
  return declaration !== undefined &&
    declaration.providerId === rustSourceVirtualModulesProviderId &&
    declaration.providerVersion === rustSourceProviderVersion &&
    declaration.moduleSpecifier === rustLangModule &&
    declaration.providerModuleId === rustLangModule &&
    declaration.exportId === rustSourceSyntaxExportIds.tokens &&
    declaration.exportName === rustSourceSyntaxExportIds.tokens &&
    declaration.signatureId === undefined;
}

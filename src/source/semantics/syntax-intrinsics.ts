import type { ProviderVirtualDeclarationFact } from "@tsonic/tsts";
import {
  rustLangModule,
  rustSourceProviderVersion,
  rustSourceSyntaxExportIds,
  rustSourceVirtualModulesProviderId,
} from "./identity.js";

export function isRustTokenQuotationDeclaration(declaration: ProviderVirtualDeclarationFact | undefined): boolean {
  return declaration !== undefined &&
    declaration.providerId === rustSourceVirtualModulesProviderId &&
    declaration.providerVersion === rustSourceProviderVersion &&
    declaration.moduleSpecifier === rustLangModule &&
    declaration.providerModuleId === rustLangModule &&
    declaration.exportId === rustSourceSyntaxExportIds.tokens &&
    declaration.exportName === rustSourceSyntaxExportIds.tokens &&
    declaration.memberId === undefined && declaration.memberName === undefined &&
    declaration.memberKey === undefined && declaration.memberStatic === undefined &&
    declaration.signatureId === undefined;
}

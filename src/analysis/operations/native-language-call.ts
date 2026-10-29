import type { Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import type { RustSourcePolicyContext } from "../../policy/model/context.js";
import { resolveProviderTypeIdentity } from "../../policy/identities/provider-types.js";
import { rustLangModule, rustSourceProviderVersion, rustSourceVirtualModulesProviderId } from "../../target-model/identities/source.js";

export interface RustLanguageCall {
  readonly selection: ResolvedSourceCallInfo;
  readonly declaration: ProviderDeclarationIdentity;
}

export function readRustLanguageCall(context: Pick<RustSourcePolicyContext, "source" | "semanticsFor">,
  expression: Node): RustLanguageCall | undefined {
  const semantics = context.semanticsFor(expression);
  const selection = semantics.operations.call(expression);
  if (selection?.outcome !== "applicable" || selection.call !== expression ||
    selection.sourceSelectedSignatureKind !== "resolved") return undefined;
  const signature = semantics.declarations.signatureDeclaration(selection.selectedSignature);
  const declaration = resolveProviderTypeIdentity([
    selection.selectedSignature,
    ...(signature === undefined ? [] : [signature]),
  ], context);
  return declaration?.providerId === rustSourceVirtualModulesProviderId &&
      declaration.providerVersion === rustSourceProviderVersion &&
      declaration.providerModuleId === rustLangModule &&
      declaration.moduleSpecifier === rustLangModule &&
      declaration.signatureId !== undefined
    ? { selection, declaration }
    : undefined;
}

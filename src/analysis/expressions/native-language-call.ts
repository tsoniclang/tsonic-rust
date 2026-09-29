import type { Node, ProviderDeclarationIdentity } from "@tsonic/tsts";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { resolveProviderTypeIdentity } from "../../policy/types/resolution/providers.js";
import {
  rustLangModule,
  rustSourceProviderVersion,
  rustSourceVirtualModulesProviderId,
} from "../../source/semantics/identity.js";

export interface RustLanguageCall {
  readonly selection: ResolvedSourceCallInfo;
  readonly declaration: ProviderDeclarationIdentity;
}

export function readRustLanguageCall(walk: RustFactWalk, expression: Node): RustLanguageCall | undefined {
  const semantics = walk.context.semanticsFor(expression);
  const selection = semantics.operations.call(expression);
  if (selection?.outcome !== "applicable" || selection.call !== expression ||
    selection.sourceSelectedSignatureKind !== "resolved") return undefined;
  const signature = semantics.declarations.signatureDeclaration(selection.selectedSignature);
  const declaration = resolveProviderTypeIdentity([
    selection.selectedSignature,
    ...(signature === undefined ? [] : [signature]),
  ], walk.context);
  return declaration?.providerId === rustSourceVirtualModulesProviderId &&
      declaration.providerVersion === rustSourceProviderVersion &&
      declaration.providerModuleId === rustLangModule &&
      declaration.moduleSpecifier === rustLangModule &&
      declaration.signatureId !== undefined
    ? { selection, declaration }
    : undefined;
}

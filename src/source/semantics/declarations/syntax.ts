import type { ProviderExportDeclaration } from "@tsonic/tsts";
import { rustSourceSyntaxExportIds } from "../identity.js";

export function rustSyntaxIntrinsicDeclarations(): readonly ProviderExportDeclaration[] {
  return Object.freeze([
    Object.freeze({ id: rustSourceSyntaxExportIds.tokens, name: rustSourceSyntaxExportIds.tokens, kind: "intrinsic" }),
  ]);
}

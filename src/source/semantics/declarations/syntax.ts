import type { ProviderExportDeclaration } from "@tsonic/tsts";
import { rustSourceSyntaxExportIds, rustSourceSyntaxMemberIds } from "../identity.js";

export function rustSyntaxIntrinsicDeclarations(): readonly ProviderExportDeclaration[] {
  return Object.freeze([
    Object.freeze({
      id: rustSourceSyntaxExportIds.tokens, name: rustSourceSyntaxExportIds.tokens, kind: "intrinsic",
      members: Object.freeze([
        Object.freeze({ id: rustSourceSyntaxMemberIds.tokenType, name: "type", kind: "intrinsic" as const }),
        Object.freeze({ id: rustSourceSyntaxMemberIds.tokenItems, name: "items", kind: "intrinsic" as const }),
      ]),
    }),
    Object.freeze({
      id: rustSourceSyntaxExportIds.native, name: rustSourceSyntaxExportIds.native, kind: "namespace",
      members: Object.freeze([
        Object.freeze({ id: rustSourceSyntaxMemberIds.nativeMacro, name: "macro", kind: "intrinsic" as const }),
        Object.freeze({ id: rustSourceSyntaxMemberIds.nativeValue, name: "value", kind: "intrinsic" as const }),
      ]),
    }),
  ]);
}

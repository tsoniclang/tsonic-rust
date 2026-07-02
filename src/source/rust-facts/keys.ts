import { defineExtensionFactKey } from "@tsonic/tsts";
import type { ExtensionFactKey, TargetTypeRef } from "@tsonic/tsts";

export const rustExtensionId = "tsonic.rust";

// Rust rendering form for a provider-selected operation. The path/name values
// come from provider metadata rows, never from source spelling.
export type RustProviderOperationForm =
  | { readonly form: "call"; readonly path: string }
  | { readonly form: "path"; readonly path: string }
  | { readonly form: "method"; readonly name: string }
  | { readonly form: "field"; readonly name: string }
  | { readonly form: "index" };

export type RustTargetOperationFact =
  | {
      readonly kind: "operator-token";
      readonly operationId: string;
      readonly operator: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "string-concat";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "provider-operation";
      readonly operationId: string;
      readonly operationKind: "method" | "constructor" | "property" | "indexer";
      readonly target: RustProviderOperationForm;
      readonly resultCarrier: TargetTypeRef;
    };

function rustTargetOperationFactEquals(left: RustTargetOperationFact, right: RustTargetOperationFact): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const rustTargetOperationFactKey: ExtensionFactKey<RustTargetOperationFact> = defineExtensionFactKey({
  extensionId: rustExtensionId,
  name: "targetOperation",
  equals: rustTargetOperationFactEquals,
});

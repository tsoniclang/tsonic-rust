import { defineExtensionFactKey } from "@tsonic/tsts";
import type { ExtensionFactKey, TargetTypeRef } from "@tsonic/tsts";

export const rustExtensionId = "tsonic.rust";

// Rust rendering form for a mapped operation. The path/name values come from
// metadata rows (provider packages or JS surface tables), never from source
// spelling.
export type RustArgumentMode = "value" | "ref";

export type RustProviderOperationForm =
  | { readonly form: "call"; readonly path: string }
  | { readonly form: "path"; readonly path: string }
  | { readonly form: "method"; readonly name: string }
  | { readonly form: "field"; readonly name: string }
  | { readonly form: "index" }
  | {
      // Free function taking the receiver as first argument.
      readonly form: "free-call";
      readonly path: string;
      readonly receiverMode: RustArgumentMode;
      readonly argModes?: readonly RustArgumentMode[];
      readonly trailingArgs?: readonly string[];
    }
  | {
      // Selected source call lowers to a native Rust operator expression.
      // Backed by std::ops trait metadata declared in provider rows.
      readonly form: "binary-operator";
      readonly operator: string;
      readonly trait: string;
    }
  | {
      // Method call on the receiver, with optional zero-argument chain calls
      // and argument passing modes.
      readonly form: "receiver-method";
      readonly name: string;
      readonly argModes?: readonly RustArgumentMode[];
      readonly argCasts?: readonly (string | undefined)[];
      readonly chain?: readonly string[];
    };

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
      readonly castResult?: string;
    }
  | {
      readonly kind: "array-literal";
      readonly operationId: string;
      readonly lane: "dense" | "sparse";
      readonly elementCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
      readonly length: number;
    }
  | {
      readonly kind: "runtime-set";
      readonly operationId: string;
      readonly target: RustProviderOperationForm;
    }
  | {
      readonly kind: "for-of";
      readonly operationId: string;
      readonly elementCarrier: TargetTypeRef;
      readonly style: "copied" | "cloned";
    }
  | {
      readonly kind: "option-check";
      readonly operationId: string;
      readonly negated: boolean;
    };

function rustTargetOperationFactEquals(left: RustTargetOperationFact, right: RustTargetOperationFact): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const rustTargetOperationFactKey: ExtensionFactKey<RustTargetOperationFact> = defineExtensionFactKey({
  extensionId: rustExtensionId,
  name: "targetOperation",
  equals: rustTargetOperationFactEquals,
});

// Receiver methods with &mut self in the runtime crates. This is runtime ABI
// metadata about Rust-side method names carried in operation facts; it is not
// source-name mapping.
export const rustMutatingReceiverMethods: ReadonlySet<string> = new Set([
  "push", "pop", "shift", "unshift", "set", "set_len", "delete_at", "add", "delete", "clear",
]);

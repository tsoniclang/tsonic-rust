import { defineExtensionFactKey } from "@tsonic/tsts";
import type { ExtensionFactKey, TargetTypeRef } from "@tsonic/tsts";


export const rustExtensionId = "tsonic.rust";

// Rust rendering form for a mapped operation. The path/name values come from
// metadata rows (provider packages or JS surface tables), never from source
// spelling.
export type RustArgumentMode = "value" | "ref" | "mut-ref";

export type RustProviderOperationForm =
  | { readonly form: "call"; readonly path: string; readonly argModes?: readonly RustArgumentMode[] }
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
      // and argument passing modes. mutatesReceiver marks &mut self methods;
      // it is row metadata, never derived from method names.
      readonly form: "receiver-method";
      readonly name: string;
      readonly argModes?: readonly RustArgumentMode[];
      readonly argCasts?: readonly (string | undefined)[];
      readonly chain?: readonly string[];
      readonly mutatesReceiver?: boolean;
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
    }
  | {
      // Member access on a project-source class instance: struct field.
      readonly kind: "source-field";
      readonly operationId: string;
      readonly name: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Method call on a project-source class instance.
      readonly kind: "source-method";
      readonly operationId: string;
      readonly name: string;
      readonly mutatesSelf: boolean;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // new C(...) on a project-source class: associated fn new.
      readonly kind: "source-constructor";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Enum member access on a project-source enum: path expression.
      readonly kind: "source-enum-member";
      readonly operationId: string;
      readonly name: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | { readonly kind: "option-none"; readonly operationId: string }
  | { readonly kind: "option-wrap"; readonly operationId: string }
  | { readonly kind: "option-coalesce"; readonly operationId: string }
  | {
      // Source-core flow marker call (borrow/borrowMut/move): the call node
      // lowers to its argument with the marker's passing shape.
      readonly kind: "flow-marker";
      readonly operationId: string;
      readonly state: "borrowed-shared" | "borrowed-mut" | "moved";
    };

// Carrier for a project-source declared type (class or enum). The backend
// renders it against the module map derived from the same source files.
export function rustSourceTypeCarrier(fileName: string, typeName: string, shape: "struct" | "enum"): TargetTypeRef {
  return { kind: "target-specific", target: "rust", name: "source-type", value: { fileName, typeName, shape } };
}

export interface RustSourceTypeCarrierValue {
  readonly fileName: string;
  readonly typeName: string;
  readonly shape: "struct" | "enum";
}

export function rustSourceTypeCarrierValue(carrier: TargetTypeRef | undefined): RustSourceTypeCarrierValue | undefined {
  if (carrier?.kind !== "target-specific" || carrier.target !== "rust" || carrier.name !== "source-type") {
    return undefined;
  }
  return carrier.value as RustSourceTypeCarrierValue;
}

function rustTargetOperationFactEquals(left: RustTargetOperationFact, right: RustTargetOperationFact): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const rustTargetOperationFactKey: ExtensionFactKey<RustTargetOperationFact> = defineExtensionFactKey({
  extensionId: rustExtensionId,
  name: "targetOperation",
  equals: rustTargetOperationFactEquals,
});


export const rustOptionWrapFactKey: ExtensionFactKey<{ readonly wrap: boolean }> = defineExtensionFactKey({
  extensionId: rustExtensionId,
  name: "optionWrap",
  equals: (left, right) => left.wrap === right.wrap,
});

// Formal source-use facts: mutation is recorded per declaration subject at
// semantics finalization; the backend never scans for writes.
export const rustMutatedBindingFactKey: ExtensionFactKey<{ readonly mutated: true }> = defineExtensionFactKey({
  extensionId: rustExtensionId,
  name: "mutatedBinding",
  equals: () => true,
});

// Referent mutation: the value behind the binding is written (field/element
// writes, &mut borrows, mutating receiver methods). Owned bindings need
// `let mut`; reference-typed bindings do not.
export const rustMutatedReferentFactKey: ExtensionFactKey<{ readonly mutated: true }> = defineExtensionFactKey({
  extensionId: rustExtensionId,
  name: "mutatedReferent",
  equals: () => true,
});

export const rustSelfModeFactKey: ExtensionFactKey<{ readonly mode: "ref" | "mut-ref" }> = defineExtensionFactKey({
  extensionId: rustExtensionId,
  name: "selfMode",
  equals: (left, right) => left.mode === right.mode,
});

import type { Node, SourcePrimitiveKind } from "@tsonic/tsts";
import type { RustBinaryOperator } from "../syntax/tokens.js";
import type { RustErrorBoundary, RustFallibleErrorBoundary } from "./error-boundary.js";
import type {
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../types/model.js";

export const rustExtensionId = "tsonic.rust";

export const rustPostCheckBinaryOperationId = "tsonic.rust.operator.post-check";
export const rustPostCheckUnaryMinusOperationId = "tsonic.rust.operator.post-check.unary-minus";
export const rustPostCheckUnaryPlusOperationId = "tsonic.rust.operator.post-check.unary-plus";

export function rustPostCheckOperationKind(
  operationId: string,
): "binary" | "unary-minus" | "unary-plus" | undefined {
  if (operationId === rustPostCheckBinaryOperationId) {
    return "binary";
  }
  if (operationId === rustPostCheckUnaryMinusOperationId) {
    return "unary-minus";
  }
  return operationId === rustPostCheckUnaryPlusOperationId ? "unary-plus" : undefined;
}

// Rust rendering form for a mapped operation. The path/name values come from
// metadata rows (provider packages or JS surface tables), never from source
// spelling.
export type RustArgumentMode = "value" | "ref" | "mut-ref";

export type RustOperationEvaluationEffect = "observable" | "pure";

export type RustProviderTypeRequirement =
  | "clone"
  | "copy"
  | { readonly kind: "trait"; readonly path: string };

export interface RustProviderTypeParameterRequirement {
  readonly name: string;
  readonly requirements: readonly RustProviderTypeRequirement[];
}

export type RustProviderGenericParameter =
  | {
      readonly kind: "type";
      readonly sourceName: string;
      readonly defaultArgument?: RustTargetGenericArgument;
    }
  | {
      readonly kind: "lifetime";
      readonly sourceName: string;
      readonly targetIdentity: string;
    }
  | {
      readonly kind: "const";
      readonly sourceName: string;
      readonly targetIdentity: string;
      readonly defaultArgument?: RustTargetGenericArgument;
    };

export type RustProviderConstantArgument =
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "float64"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "none" };

export type RustProviderChainStep =
  | { readonly kind: "method"; readonly name: string }
  | { readonly kind: "copy-selected-carrier" };

export type RustValueConversionId =
  | "checked-i32-to-usize"
  | "checked-i32-to-u8"
  | "checked-usize-to-i32"
  | "checked-isize-to-i32"
  | "checked-u32-to-i32"
  | "exact-u8-to-i32"
  | "exact-i32-to-f64"
  | "checked-f64-to-i32-trunc"
  | "js-number-from-isize"
  | "js-number-from-usize"
  | "js-number-from-u64"
  | "js-value-from-bool"
  | "js-value-from-f64"
  | "js-value-from-i32"
  | "js-value-from-null"
  | "js-value-from-string"
  | "js-value-from-symbol"
  | "js-value-from-undefined"
  | "js-value-clone"
  | "owned-string-from-borrowed-str";

export type RustNonOptionValueConversion =
  | {
      readonly kind: "semantic-conversion";
      readonly id: RustValueConversionId;
    }
  | {
      readonly kind: "numeric-promotion";
      readonly source: SourcePrimitiveKind;
      readonly target: SourcePrimitiveKind;
    }
  | {
      readonly kind: "raw-pointer-mut-to-const";
      readonly pointee: TargetTypeRef;
    }
  | {
      readonly kind: "copy-from-reference";
      readonly target: TargetTypeRef;
    }
  | {
      readonly kind: "source-union-variant";
      readonly source: TargetTypeRef;
      readonly target: TargetTypeRef;
      readonly variantName: string;
    }
  | {
      readonly kind: "bottom-coercion";
      readonly source: TargetTypeRef;
      readonly target: TargetTypeRef;
    }
  | {
      readonly kind: "js-argument-vector-callback";
      readonly lane: "native" | "exact";
      readonly source: TargetTypeRef;
      readonly target: TargetTypeRef;
      readonly projections: readonly (
        | "native-string"
        | "exact-string"
        | "value"
        | "rest-values"
      )[];
      readonly sourceFallible: boolean;
    }
  | {
      readonly kind: "js-value-from-option";
      readonly source: TargetTypeRef;
      readonly element: TargetTypeRef;
      readonly elementConversion: RustNonOptionValueConversion;
    }
  | {
      readonly kind: "js-value-from-array";
      readonly source: TargetTypeRef;
      readonly element: TargetTypeRef;
      readonly elementConversion: RustNonOptionValueConversion;
    }
  | {
      readonly kind: "js-value-from-closed-carrier";
      readonly source: TargetTypeRef;
    }
  | {
      readonly kind: "js-value-from-source-union";
      readonly source: TargetTypeRef;
      readonly variants: readonly {
        readonly name: string;
        readonly carrier: TargetTypeRef;
        readonly conversion: RustNonOptionValueConversion;
      }[];
    }
  | {
      readonly kind: "js-value-from-structural-to-json";
      readonly source: TargetTypeRef;
      readonly storageIndex: number;
      readonly resultCarrier: TargetTypeRef;
      readonly passesPropertyKey: boolean;
      readonly resultConversion: RustNonOptionValueConversion;
    }
  | {
      readonly kind: "js-value-from-structural-object";
      readonly source: TargetTypeRef;
      readonly fields: readonly {
        readonly sourceName: string;
        readonly storageIndex: number;
        readonly sourceCarrier: TargetTypeRef;
        readonly presence: "required" | "optional";
        readonly conversion: RustNonOptionValueConversion;
      }[];
    };

export type RustValueConversion =
  | RustNonOptionValueConversion
  | {
      readonly kind: "option-some";
      readonly element: TargetTypeRef;
    }
  | {
      readonly kind: "option-map";
      readonly elementConversion: RustNonOptionValueConversion;
    };

export type RustProviderOperationForm =
  | {
      // Value exports with no runtime representation (receiver markers).
      // Any direct lowering fails closed.
      readonly form: "marker";
    }
  | { readonly form: "call"; readonly path: string; readonly argModes?: readonly RustArgumentMode[]; readonly argConversions?: readonly (RustValueConversion | undefined)[]; readonly argOrder?: readonly number[]; readonly trailingArguments?: readonly RustProviderConstantArgument[]; readonly chain?: readonly RustProviderChainStep[] }
  | {
      readonly form: "source-module-construction";
      readonly path: string;
      readonly sourceArgumentIndex: number;
      readonly targetArgumentIndex: number;
      readonly bootstrap: {
        readonly id: string;
        readonly path: string;
        readonly errorBoundary: RustFallibleErrorBoundary;
        readonly errorCarrier?: TargetTypeRef;
      };
      readonly argModes?: readonly RustArgumentMode[];
      readonly argConversions?: readonly (RustValueConversion | undefined)[];
      readonly argOrder?: readonly number[];
    }
  | { readonly form: "struct-variant"; readonly path: string; readonly fields: readonly string[] }
  | { readonly form: "expression-macro"; readonly path: string; readonly delimiter: "parentheses" | "brackets" | "braces" }
  | {
      readonly form: "call-c-variadic";
      readonly path: string;
      readonly fixedArgumentModes: readonly RustArgumentMode[];
    }
  | {
      // Free function taking all arguments as one &[&str] slice (variadic
      // string APIs like path join).
      readonly form: "call-str-slice";
      readonly path: string;
    }
  | {
      // Free function taking the selected source receiver followed by all
      // source arguments as one &[&str] slice.
      readonly form: "free-call-str-slice";
      readonly path: string;
      readonly receiverMode: RustArgumentMode;
    }
  | {
      readonly form: "call-value-slice";
      readonly path: string;
      readonly leadingArguments: readonly {
        readonly carrier: TargetTypeRef;
        readonly mode: RustArgumentMode;
      }[];
      readonly elementCarrier: TargetTypeRef;
    }
  | {
      readonly form: "call-value-array";
      readonly path: string;
      readonly leadingArguments: readonly {
        readonly carrier: TargetTypeRef;
        readonly mode: RustArgumentMode;
      }[];
      readonly elementCarrier: TargetTypeRef;
    }
  | {
      // Receiver method taking fixed leading arguments followed by one
      // owned fixed-size array assembled from the remaining source arguments.
      readonly form: "receiver-value-array";
      readonly name: string;
      readonly receiverMode: RustArgumentMode;
      readonly leadingArguments: readonly {
        readonly carrier: TargetTypeRef;
        readonly mode: RustArgumentMode;
      }[];
      readonly elementCarrier: TargetTypeRef;
    }
  | {
      // Receiver method taking fixed leading arguments followed by one
      // fixed-size array of runtime-tagged alternatives. Each source value
      // must match exactly one declared alternative carrier.
      readonly form: "receiver-tagged-array";
      readonly name: string;
      readonly receiverMode: RustArgumentMode;
      readonly leadingArguments: readonly {
        readonly carrier: TargetTypeRef;
        readonly mode: RustArgumentMode;
      }[];
      readonly elementCarrier: TargetTypeRef;
      readonly alternatives: readonly {
        readonly inputCarrier: TargetTypeRef;
        readonly mode: RustArgumentMode;
        readonly constructorPath: string;
      }[];
    }
  | { readonly form: "path"; readonly path: string }
  | { readonly form: "reference-path"; readonly path: string; readonly mutable: boolean }
  | { readonly form: "static"; readonly path: string }
  | { readonly form: "method"; readonly name: string }
  | {
      // Static helper lowering to a method on the first argument
      // (Math.floor(x) -> x.floor()).
      readonly form: "arg-method";
      readonly name: string;
    }
  | {
      // Receiver-swapping method: the first argument becomes the Rust
      // receiver and the JS receiver becomes the first Rust argument
      // (text.replace(re, r) -> re.replace(&text, r)).
      readonly form: "arg-receiver-method";
      readonly name: string;
      readonly argModes?: readonly RustArgumentMode[];
      readonly argConversions?: readonly (RustValueConversion | undefined)[];
    }
  | {
      // Calls the exact selected symbol-keyed method stored on the first
      // argument. The source receiver becomes the callable's first argument.
      readonly form: "arg-structural-method";
      readonly storageIndex: number;
      readonly argModes: readonly RustArgumentMode[];
      readonly argConversions?: readonly (RustValueConversion | undefined)[];
      readonly trailingArguments?: readonly RustProviderConstantArgument[];
    }
  | { readonly form: "field"; readonly name: string }
  | {
      readonly form: "index";
      readonly indexConversion?: RustValueConversion;
    }
  | {
      // Free function taking the receiver as first argument.
      readonly form: "free-call";
      readonly path: string;
      readonly receiverMode: RustArgumentMode;
      readonly argModes?: readonly RustArgumentMode[];
      readonly argConversions?: readonly (RustValueConversion | undefined)[];
      readonly trailingArguments?: readonly RustProviderConstantArgument[];
      readonly argOrder?: readonly number[];
    }
  | {
      // Selected source call lowers to a native Rust operator expression.
      // Backed by std::ops trait metadata declared in provider rows.
      readonly form: "binary-operator";
      readonly operator: RustBinaryOperator;
      readonly trait: string;
    }
  | {
      readonly form: "trait-call";
      readonly owner: TargetTypeRef;
      readonly traitPath: string;
      readonly traitGenericArguments: readonly RustTargetGenericArgument[];
      readonly method: string;
      readonly receiverMode?: RustArgumentMode;
      readonly argModes?: readonly RustArgumentMode[];
    }
  | {
      readonly form: "trait-associated-value";
      readonly owner: TargetTypeRef;
      readonly traitPath: string;
      readonly traitGenericArguments: readonly RustTargetGenericArgument[];
      readonly name: string;
    }
  | {
      readonly form: "associated-value";
      readonly owner: TargetTypeRef;
      readonly name: string;
    }
  | {
      // Method call on the receiver, with optional zero-argument chain calls
      // and argument passing modes. mutatesReceiver marks &mut self methods;
      // it is row metadata, never derived from method names.
      readonly form: "receiver-method";
      readonly name: string;
      readonly argModes?: readonly RustArgumentMode[];
      readonly argConversions?: readonly (RustValueConversion | undefined)[];
      readonly argOrder?: readonly number[];
      readonly trailingArguments?: readonly RustProviderConstantArgument[];
      readonly chain?: readonly RustProviderChainStep[];
      readonly mutatesReceiver?: boolean;
    };

export interface RustProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind = RustProviderFactOperationKind,
> {
  readonly kind: "provider-operation";
  readonly operationId: string;
  readonly operationKind: OperationKind;
  readonly target: RustProviderOperationForm;
  readonly resultCarrier: TargetTypeRef;
  readonly sourceResultCarrier?: TargetTypeRef;
  readonly sourceAbsenceCarrier?: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly receiverCarrier?: TargetTypeRef;
  readonly genericParameters?: readonly RustProviderGenericParameter[];
  readonly typeRequirements?: readonly RustProviderTypeParameterRequirement[];
  readonly targetGenericArguments?: readonly RustTargetGenericArgument[];
  readonly resultConversion?: RustValueConversion;
  readonly compileTimeSourceArgumentIndexes?: readonly number[];
  readonly isAsync: boolean;
  readonly isFallible: boolean;
  readonly returnedFuture?: {
    readonly awaiting: "infallible" | "fallible";
    readonly errorBoundary: RustErrorBoundary;
    readonly errorCarrier?: TargetTypeRef;
  };
  readonly evaluation?: "pure";
  readonly errorBoundary: RustErrorBoundary;
  readonly errorCarrier?: TargetTypeRef;
  readonly isUnsafe?: boolean;
}

export interface RustCallbackOperationTemplate {
  readonly shape: "direct" | "map" | "reduce";
  readonly sourceArgumentIndex: number;
  readonly accumulatorArgumentIndex?: number;
  readonly argumentAdapter?: {
    readonly kind: "regexp-replacement";
    readonly lane: "native" | "exact";
  };
  readonly failure:
    | {
        readonly kind: "invocation";
        readonly fallibleTarget: RustProviderOperationForm;
      }
    | { readonly kind: "returned-future" };
}

export interface RustRuntimeSetTemplate {
  readonly kind: "runtime-set";
  readonly operationId: string;
  readonly target: RustProviderOperationForm;
  readonly parameterCarriers: readonly TargetTypeRef[];
}

export type RustProviderFactOperationKind = "method" | "constructor" | "property" | "indexer";
export type RustRuntimeSetOperationKind = "property-set" | "index-set";
export type RustFinalizedOperationKind = RustProviderFactOperationKind | RustRuntimeSetOperationKind;

export interface RustOptionalChainFact {
  readonly expression: Node;
  readonly guard: Node;
  readonly operationKind: "property" | "indexer" | "method";
  readonly sourceGuardCarrier: TargetTypeRef;
  readonly selectedGuardCarrier: TargetTypeRef;
  readonly innerResultCarrier: TargetTypeRef;
  readonly resultCarrier: TargetTypeRef;
  readonly lowering: "map" | "and-then";
}

export interface RustSourceCallParameterPlan {
  readonly form: "required" | "optional" | "default" | "rest";
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
  readonly inputs: readonly {
    readonly sourceArgumentIndex: number;
    readonly sourceForm: "value" | "spread-element" | "spread-sequence";
    readonly sourceParameterForm: "parameter" | "rest-element" | "rest-sequence";
    readonly carrier: TargetTypeRef;
    readonly spreadElementIndex?: number;
  }[];
}

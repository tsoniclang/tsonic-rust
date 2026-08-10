import type { TargetTypeRef } from "../../policy/types.js";
import { defineRustPlanKey } from "../../policy/keys.js";
import type { RustPlanKey } from "../../policy/keys.js";
import type {
  RustBinaryOperator,
  RustOperatorToken,
} from "../../common/rust-syntax.js";
import { closedMetadataEquals } from "../../common/closed-metadata.js";
import type {
  RustFinalizedOperationAbiFor,
} from "./finalized-operation-abi.js";

export type {
  RustAssignmentOperator,
  RustBinaryOperator,
  RustOperatorToken,
} from "../../common/rust-syntax.js";


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

export type RustProviderConstantArgument =
  | { readonly kind: "integer"; readonly value: number }
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
  | "js-number-from-u64";

export interface RustValueConversion {
  readonly kind: "semantic-conversion";
  readonly id: RustValueConversionId;
}

export type RustProviderOperationForm =
  | {
      // Value exports with no runtime representation (receiver markers).
      // Any direct lowering fails closed.
      readonly form: "marker";
    }
  | { readonly form: "call"; readonly path: string; readonly argModes?: readonly RustArgumentMode[]; readonly argConversions?: readonly (RustValueConversion | undefined)[]; readonly argOrder?: readonly number[]; readonly trailingArguments?: readonly RustProviderConstantArgument[]; readonly chain?: readonly RustProviderChainStep[] }
  | {
      // Free function taking all arguments as one &[&str] slice (variadic
      // string APIs like path join).
      readonly form: "call-str-slice";
      readonly path: string;
    }
  | {
      // Free function taking a leading format string by reference and the
      // remaining arguments as one &[JsValue] slice.
      readonly form: "call-jsvalue-slice";
      readonly path: string;
    }
  | { readonly form: "path"; readonly path: string }
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
      // Method call on the receiver, with optional zero-argument chain calls
      // and argument passing modes. mutatesReceiver marks &mut self methods;
      // it is row metadata, never derived from method names.
      readonly form: "receiver-method";
      readonly name: string;
      readonly argModes?: readonly RustArgumentMode[];
      readonly argConversions?: readonly (RustValueConversion | undefined)[];
      readonly argOrder?: readonly number[];
      readonly chain?: readonly RustProviderChainStep[];
      readonly mutatesReceiver?: boolean;
    };

export interface RustProviderOperationTemplate {
  readonly kind: "provider-operation";
  readonly operationId: string;
  readonly operationKind: "method" | "constructor" | "property" | "indexer";
  readonly target: RustProviderOperationForm;
  readonly resultCarrier: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly resultConversion?: RustValueConversion;
  readonly compileTimeSourceArgumentIndexes?: readonly number[];
  readonly isAsync: boolean;
  readonly isFallible: boolean;
}

export interface RustRuntimeSetTemplate {
  readonly kind: "runtime-set";
  readonly operationId: string;
  readonly target: RustProviderOperationForm;
  readonly parameterCarriers: readonly TargetTypeRef[];
}

export type RustProviderFactOperationKind = "method" | "constructor" | "property" | "indexer";
export type RustRuntimeSetOperationKind = "property-set" | "index-set";

export type RustTargetOperationFact =
  | {
      readonly kind: "operator-token";
      readonly operationId: string;
      readonly operator: RustOperatorToken;
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
      readonly resultCarrier: TargetTypeRef;
      readonly abi: RustFinalizedOperationAbiFor<RustProviderFactOperationKind>;
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
      readonly abi: RustFinalizedOperationAbiFor<RustRuntimeSetOperationKind>;
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
      readonly optionOperand: "left" | "right";
    }
  | {
      // Member access on a project-source class instance: struct field.
      readonly kind: "source-field";
      readonly operationId: string;
      readonly name: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Exact TSTS-selected project-source callable. The source lifecycle
      // finalizes the target ABI before the backend consumes this fact.
      readonly kind: "source-call";
      readonly operationId: string;
      readonly target:
        | { readonly form: "function"; readonly fileName: string; readonly name: string }
        | { readonly form: "method"; readonly name: string; readonly mutatesSelf: boolean }
        | { readonly form: "static-method"; readonly name: string; readonly typeCarrier: TargetTypeRef }
        | { readonly form: "constructor"; readonly typeCarrier: TargetTypeRef };
      readonly parameterCarriers: readonly TargetTypeRef[];
      readonly argumentModes: readonly RustArgumentMode[];
      readonly targetTypeArguments?: readonly TargetTypeRef[];
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Enum member access on a project-source enum: path expression.
      readonly kind: "source-enum-member";
      readonly operationId: string;
      readonly name: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Object literal lowering to a generated record struct: field order and
      // carriers come from the finalized shape declaration.
      readonly kind: "record-literal";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
      readonly fieldNames: readonly string[];
    }
  | { readonly kind: "fixed-array-literal"; readonly operationId: string }
  | { readonly kind: "fixed-index"; readonly operationId: string; readonly index: number }
  | {
      readonly kind: "tuple-literal";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "tuple-index";
      readonly operationId: string;
      readonly index: number;
      readonly resultCarrier: TargetTypeRef;
    }
  | { readonly kind: "await-op"; readonly operationId: string; readonly resultCarrier: TargetTypeRef }
  | {
      // Arrow-function argument lowering to a Rust closure. Parameter names
      // come from the arrow declaration; byRefCopy params bind as |&x|.
      readonly kind: "closure";
      readonly operationId: string;
      readonly byRefCopyParams: readonly boolean[];
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // `throw new Error(message)` lowering to an Err return.
      readonly kind: "throw-op";
      readonly operationId: string;
      readonly constructorOperationId: string;
    }
  | {
      // Compile-validated constant RegExp construction (literal or
      // new RegExp with literal arguments).
      readonly kind: "regexp-create";
      readonly operationId: string;
      readonly pattern: string;
      readonly flags: string;
    }
  | { readonly kind: "option-none"; readonly operationId: string }
  | { readonly kind: "option-wrap"; readonly operationId: string }
  | { readonly kind: "option-coalesce"; readonly operationId: string }
  | { readonly kind: "nullish-identity"; readonly operationId: string; readonly resultCarrier: TargetTypeRef }
  | {
      readonly kind: "source-conversion";
      readonly operationId: string;
      readonly conversion?: RustValueConversion;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Rust-owned flow operation selected from a finalized neutral source
      // marker fact. The call lowers to its argument with the Rust passing shape.
      readonly kind: "flow-marker";
      readonly operationId: string;
      readonly state: "borrowed-shared" | "borrowed-mut" | "moved";
    };

export function rustTargetOperationResultCarrier(fact: RustTargetOperationFact): TargetTypeRef | undefined {
  switch (fact.kind) {
    case "provider-operation":
    case "operator-token":
    case "string-concat":
    case "array-literal":
    case "source-field":
    case "source-call":
    case "source-enum-member":
    case "record-literal":
    case "tuple-literal":
    case "tuple-index":
    case "await-op":
    case "closure":
    case "source-conversion":
    case "nullish-identity":
      return fact.resultCarrier;
    case "for-of":
      return fact.elementCarrier;
    default:
      return undefined;
  }
}

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
  const value = carrier.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== "fileName" || keys[1] !== "shape" || keys[2] !== "typeName") {
    return undefined;
  }
  const candidate = value as {
    readonly fileName?: unknown;
    readonly typeName?: unknown;
    readonly shape?: unknown;
  };
  return typeof candidate.fileName === "string" && candidate.fileName.length > 0 &&
    typeof candidate.typeName === "string" && candidate.typeName.length > 0 &&
    (candidate.shape === "struct" || candidate.shape === "enum")
    ? {
        fileName: candidate.fileName,
        typeName: candidate.typeName,
        shape: candidate.shape,
      }
    : undefined;
}

function rustTargetOperationFactEquals(left: RustTargetOperationFact, right: RustTargetOperationFact): boolean {
  return closedMetadataEquals(left, right);
}

export const rustTargetOperationFactKey: RustPlanKey<RustTargetOperationFact> =
  defineRustPlanKey("targetOperation", rustTargetOperationFactEquals);


export const rustOptionWrapFactKey: RustPlanKey<{ readonly wrap: boolean }> =
  defineRustPlanKey("optionWrap", (left, right) => left.wrap === right.wrap);

export interface RustSourceBindingFact {
  readonly sourceName: string;
  readonly fileName: string;
}

export const rustSourceBindingFactKey: RustPlanKey<RustSourceBindingFact> =
  defineRustPlanKey("sourceBinding", closedMetadataEquals);

// Formal source-use facts: mutation is recorded per declaration subject at
// semantics finalization; the backend never scans for writes.
export const rustMutatedBindingFactKey: RustPlanKey<{ readonly mutated: true }> =
  defineRustPlanKey("mutatedBinding", () => true);

// Referent mutation: the value behind the binding is written (field/element
// writes, &mut borrows, mutating receiver methods). Owned bindings need
// `let mut`; reference-typed bindings do not.
export const rustMutatedReferentFactKey: RustPlanKey<{ readonly mutated: true }> =
  defineRustPlanKey("mutatedReferent", () => true);

export const rustSelfModeFactKey: RustPlanKey<{ readonly mode: "ref" | "mut-ref" }> =
  defineRustPlanKey("selfMode", (left, right) => left.mode === right.mode);

export const rustUnionVariantsFactKey: RustPlanKey<{ readonly variants: readonly { readonly name: string; readonly literal: string }[] }> =
  defineRustPlanKey("unionVariants", closedMetadataEquals);

export interface RustAsyncFunctionFact {
  readonly isAsync: true;
  readonly outputCarrier: TargetTypeRef;
}

export const rustAsyncFunctionFactKey: RustPlanKey<RustAsyncFunctionFact> =
  defineRustPlanKey("asyncFunction", closedMetadataEquals);

export interface RustSourceParameterAbiFact {
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
}

export const rustSourceParameterAbiFactKey: RustPlanKey<RustSourceParameterAbiFact> =
  defineRustPlanKey("sourceParameterAbi", closedMetadataEquals);

// Declarations whose lowering returns TsonicResult<T>: they throw, or they
// transitively call fallible operations outside a try boundary.
export const rustFallibleFactKey: RustPlanKey<{ readonly fallible: true }> =
  defineRustPlanKey("fallible", () => true);

export interface RustSourceCallEffectsFact {
  readonly invocation: "infallible" | "fallible";
  readonly awaiting: "not-applicable" | "infallible" | "fallible";
}

// Total post-fixpoint effects for an exact selected project-source call.
export const rustSourceCallEffectsFactKey: RustPlanKey<RustSourceCallEffectsFact> =
  defineRustPlanKey("sourceCallEffects", closedMetadataEquals);

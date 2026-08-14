import type { TargetTypeRef } from "../../policy/types.js";
import type { Node, SourcePrimitiveKind } from "@tsonic/tsts";
import { defineRustPlanKey } from "../../policy/keys.js";
import type { RustPlanKey } from "../../policy/keys.js";
import type {
  RustBinaryOperator,
  RustOperationSymbol,
  RustOperatorToken,
} from "../../common/rust-syntax.js";
import { closedMetadataEquals } from "../../common/closed-metadata.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type {
  RustFinalizedOperationAbiFor,
  RustFinalizedValueConversion,
} from "./finalized-operation-abi.js";

export type {
  RustAssignmentOperator,
  RustBinaryOperator,
  RustOperationSymbol,
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
  | "js-number-from-u64"
  | "js-value-from-bool"
  | "js-value-from-f64"
  | "js-value-from-i32"
  | "js-value-from-string"
  | "js-value-clone";

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
      readonly kind: "source-union-variant";
      readonly source: TargetTypeRef;
      readonly target: TargetTypeRef;
      readonly variantName: string;
    }
  | {
      readonly kind: "bottom-coercion";
      readonly source: TargetTypeRef;
      readonly target: TargetTypeRef;
    };

export type RustValueConversion =
  | RustNonOptionValueConversion
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

export interface RustProviderOperationTemplate<
  OperationKind extends RustProviderFactOperationKind | RustRuntimeSetOperationKind = RustProviderFactOperationKind,
> {
  readonly kind: "provider-operation";
  readonly operationId: string;
  readonly operationKind: OperationKind;
  readonly target: RustProviderOperationForm;
  readonly resultCarrier: TargetTypeRef;
  readonly parameterCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly receiverCarrier?: TargetTypeRef;
  readonly typeParameters?: readonly string[];
  readonly resultConversion?: RustValueConversion;
  readonly compileTimeSourceArgumentIndexes?: readonly number[];
  readonly isAsync: boolean;
  readonly isFallible: boolean;
  readonly errorBoundary: "none" | "provider-native" | "source-program";
  readonly isUnsafe?: boolean;
}

export interface RustCallbackOperationTemplate {
  readonly shape: "direct" | "map" | "reduce";
  readonly sourceArgumentIndex: number;
  readonly accumulatorArgumentIndex?: number;
  readonly fallibleTarget: RustProviderOperationForm;
}

export interface RustRuntimeSetTemplate {
  readonly kind: "runtime-set";
  readonly operationId: string;
  readonly target: RustProviderOperationForm;
  readonly parameterCarriers: readonly TargetTypeRef[];
}

export type RustProviderFactOperationKind = "method" | "constructor" | "property" | "indexer";
export type RustRuntimeSetOperationKind = "property-set" | "index-set";

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

export type RustTargetOperationFact =
  | {
      readonly kind: "operator-token";
      readonly operationId: string;
      readonly operator: RustOperatorToken;
      readonly resultCarrier: TargetTypeRef;
      readonly leftConversion?: RustValueConversion;
      readonly rightConversion?: RustValueConversion;
    }
  | {
      readonly kind: "operator-call";
      readonly operationId: string;
      readonly operator: RustOperationSymbol;
      readonly path: string;
      readonly resultCarrier: TargetTypeRef;
      readonly fallible: boolean;
      readonly operandModes: readonly [RustArgumentMode, RustArgumentMode];
      readonly leftConversion?: RustValueConversion;
      readonly rightConversion?: RustValueConversion;
    }
  | {
      readonly kind: "string-concat";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "conditional";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "template-string";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
      readonly substitutions: readonly {
        readonly expression: Node;
        readonly carrier: TargetTypeRef;
      }[];
    }
  | {
      readonly kind: "typeof";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
      readonly result: "boolean" | "number" | "bigint" | "string" | "function" | "object" | "undefined";
    }
  | {
      readonly kind: "void-expression";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "identity-expression";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "non-null-expression";
      readonly operationId: string;
      readonly sourceCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "switch";
      readonly operationId: string;
      readonly discriminantCarrier: TargetTypeRef;
      readonly clauses: readonly {
        readonly clause: Node;
        readonly expression?: Node;
        readonly carrier?: TargetTypeRef;
      }[];
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
      readonly lane: "native" | "js";
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
      readonly kind: "iteration";
      readonly operationId: string;
      readonly iterationKind: "for-in";
      readonly elementCarrier: TargetTypeRef;
      readonly lowering:
        | { readonly kind: "dense-index-keys" }
        | { readonly kind: "js-array-index-keys" }
        | { readonly kind: "static-keys"; readonly keys: readonly string[] };
    }
  | {
      readonly kind: "iteration";
      readonly operationId: string;
      readonly iterationKind: "for-of" | "for-await-of";
      readonly elementCarrier: TargetTypeRef;
      readonly lowering:
        | {
            readonly kind: "borrowed";
            readonly style: "copied" | "cloned";
            readonly input: "direct" | "reference";
          }
        | { readonly kind: "js-array" }
        | { readonly kind: "receiver-method"; readonly name: string }
        | { readonly kind: "owned" }
        | { readonly kind: "async-generator" };
    }
  | {
      readonly kind: "option-check";
      readonly operationId: string;
      readonly negated: boolean;
      readonly optionOperand: "left" | "right";
    }
  | {
      readonly kind: "option-value-equality";
      readonly operationId: string;
      readonly negated: boolean;
      readonly optionOperand: "left" | "right";
      readonly optionCarrier: TargetTypeRef;
      readonly valueCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "disjoint-equality";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
      readonly value: boolean;
    }
  | {
      readonly kind: "project-type-test";
      readonly operationId: string;
      readonly sourceCarrier: TargetTypeRef;
      readonly dispatchCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
      readonly lowering:
        | { readonly kind: "dispatch" }
        | { readonly kind: "constant"; readonly value: boolean }
        | { readonly kind: "option-presence" };
    }
  | {
      readonly kind: "program-error-type-test";
      readonly operationId: string;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly variant: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "source-field";
      readonly operationId: string;
      readonly receiverCarrier: TargetTypeRef;
      readonly storage: "project-object" | "object-handle";
      readonly storageIndex: number;
      readonly resultCarrier: TargetTypeRef;
      readonly dispatch?: {
        readonly read: string;
        readonly write: string;
        readonly ownerCarrier: TargetTypeRef;
      };
    }
  | {
      readonly kind: "source-static-field";
      readonly operationId: string;
      readonly storageFileName: string;
      readonly storageName: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "source-accessor";
      readonly operationId: string;
      readonly accessMode: "read" | "write" | "read-write";
      readonly receiver:
        | { readonly kind: "instance" }
        | { readonly kind: "static"; readonly typeCarrier: TargetTypeRef };
      readonly read?: {
        readonly method: string;
        readonly resultCarrier: TargetTypeRef;
      };
      readonly write?: {
        readonly method: string;
        readonly valueCarrier: TargetTypeRef;
      };
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "source-union-field";
      readonly operationId: string;
      readonly unionCarrier: TargetTypeRef;
      readonly selectedVariantIndexes: readonly number[];
      readonly variants: readonly {
        readonly name: string;
        readonly carrier: TargetTypeRef;
        readonly field?: {
          readonly storage: "project-object" | "object-handle";
          readonly storageIndex: number;
        };
      }[];
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      // Exact TSTS-selected project-source callable. The source lifecycle
      // finalizes the target ABI before the backend consumes this fact.
      readonly kind: "source-call";
      readonly operationId: string;
      readonly target:
        | { readonly form: "function"; readonly fileName: string; readonly name: string }
        | {
            readonly form: "method";
            readonly name: string;
            readonly mutatesSelf: boolean;
            readonly dispatch?: {
              readonly virtualSlot: string;
              readonly exactSlot: string;
              readonly selected: "virtual" | "exact";
              readonly ownerCarrier: TargetTypeRef;
            };
          }
        | { readonly form: "static-method"; readonly name: string; readonly typeCarrier: TargetTypeRef }
        | { readonly form: "callable"; readonly carrier: TargetTypeRef }
        | {
            readonly form: "constructor";
            readonly name: string;
            readonly typeCarrier: TargetTypeRef;
          };
      readonly parameters: readonly RustSourceCallParameterPlan[];
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
      readonly storage: "project-object" | "object-handle";
      readonly resultCarrier: TargetTypeRef;
      readonly fields: readonly {
        readonly sourceName: string;
        readonly storageIndex: number;
      }[];
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
      // Function-expression argument lowering to a Rust closure. Parameter
      // names come from the selected expression; byRefCopy params bind as |&x|.
      readonly kind: "closure";
      readonly operationId: string;
      readonly byRefCopyParams: readonly boolean[];
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "throw-op";
      readonly operationId: string;
      readonly error:
        | { readonly kind: "runtime"; readonly constructorOperationId: string }
        | { readonly kind: "project"; readonly carrier: TargetTypeRef; readonly variant: string }
        | { readonly kind: "program" };
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
  | {
      readonly kind: "option-coalesce";
      readonly operationId: string;
      readonly rightOperand: "value" | "option";
      readonly resultCarrier: TargetTypeRef;
    }
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
    }
  | {
      readonly kind: "typed-location";
      readonly operationId: string;
      readonly operation: RustTypedLocationOperationKind;
      readonly pointeeCarrier: TargetTypeRef;
      readonly locationCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "native-pointer";
      readonly operationId: string;
      readonly operation: "load" | "store" | "offset";
      readonly pointerExpression: Node;
      readonly pointerCarrier: Extract<TargetTypeRef, { readonly kind: "pointer" }>;
      readonly pointeeCarrier: TargetTypeRef;
      readonly valueExpression?: Node;
      readonly valueCarrier?: TargetTypeRef;
      readonly offsetExpression?: Node;
      readonly offsetCarrier?: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    };

export type RustTypedLocationOperationKind =
  | "address-of"
  | "allocate"
  | "load"
  | "store"
  | "equal-pointer";

interface RustTypedLocationPlanBase {
  readonly call: Node;
  readonly operation: RustTypedLocationOperationKind;
  readonly pointeeCarrier: TargetTypeRef;
  readonly locationCarrier: TargetTypeRef;
}

export type RustTypedLocationPlan = RustTypedLocationPlanBase & (
  | {
      readonly operation: "address-of";
      readonly storageExpression: Node;
      readonly storageDeclaration: Node;
      readonly rootExpression: Node;
      readonly rootDeclaration: Node;
      readonly locationIdentity: Node;
    }
  | {
      readonly operation: "allocate";
      readonly initialExpression: Node;
      readonly locationIdentity: Node;
    }
  | {
      readonly operation: "load";
      readonly pointerExpression: Node;
    }
  | {
      readonly operation: "store";
      readonly pointerExpression: Node;
      readonly valueExpression: Node;
    }
  | {
      readonly operation: "equal-pointer";
      readonly leftExpression: Node;
      readonly rightExpression: Node;
    }
);

export function rustTargetOperationResultCarrier(fact: RustTargetOperationFact): TargetTypeRef | undefined {
  switch (fact.kind) {
    case "provider-operation":
    case "operator-token":
    case "operator-call":
    case "string-concat":
    case "template-string":
    case "typeof":
    case "void-expression":
    case "array-literal":
    case "source-field":
    case "source-static-field":
    case "source-accessor":
    case "source-union-field":
    case "source-call":
    case "source-enum-member":
    case "record-literal":
    case "tuple-literal":
    case "tuple-index":
    case "await-op":
    case "closure":
    case "source-conversion":
    case "option-coalesce":
    case "nullish-identity":
    case "non-null-expression":
    case "disjoint-equality":
    case "typed-location":
    case "native-pointer":
    case "project-type-test":
    case "program-error-type-test":
      return fact.resultCarrier;
    case "iteration":
      return fact.elementCarrier;
    case "option-check":
    case "option-value-equality":
      return { kind: "source-primitive", name: "bool" };
    default:
      return undefined;
  }
}

function rustTargetOperationFactEquals(left: RustTargetOperationFact, right: RustTargetOperationFact): boolean {
  return closedMetadataEquals(left, right);
}

export const rustTargetOperationFactKey: RustPlanKey<RustTargetOperationFact> =
  defineRustPlanKey("targetOperation", rustTargetOperationFactEquals);

export interface RustPreparedOperationResultFact {
  readonly operationId: string;
  readonly operationKind: RustProviderFactOperationKind;
  readonly resultCarrier: TargetTypeRef;
}

export const rustPreparedOperationResultFactKey: RustPlanKey<RustPreparedOperationResultFact> =
  defineRustPlanKey("preparedOperationResult", (left, right) =>
    left.operationId === right.operationId &&
    left.operationKind === right.operationKind &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier));

export const rustOptionalChainFactKey: RustPlanKey<RustOptionalChainFact> =
  defineRustPlanKey("optionalChain", closedMetadataEquals);

export const rustTypedLocationPlanKey: RustPlanKey<RustTypedLocationPlan> =
  defineRustPlanKey("typedLocationPlan", rustTypedLocationPlanEquals);

export const rustLocationStorageFactKey: RustPlanKey<{
  readonly valueCarrier: TargetTypeRef;
}> = defineRustPlanKey(
  "locationStorage",
  (left, right) => rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier),
);

export interface RustClosureCaptureFact {
  readonly captures: readonly {
    readonly declaration: Node;
    readonly reference: Node;
    readonly carrier: TargetTypeRef;
    readonly storage: "value" | "location";
  }[];
  readonly recursiveDeclaration?: Node;
}

export const rustClosureCaptureFactKey: RustPlanKey<RustClosureCaptureFact> = defineRustPlanKey(
  "closureCaptures",
  (left, right) => left.recursiveDeclaration === right.recursiveDeclaration &&
    left.captures.length === right.captures.length &&
    left.captures.every((capture, index) => {
      const other = right.captures[index];
      return other !== undefined &&
        capture.declaration === other.declaration &&
        capture.reference === other.reference &&
        capture.storage === other.storage &&
        rustTargetTypeRefEquals(capture.carrier, other.carrier);
    }),
);

export interface RustSourceCallableValueFact {
  readonly form: "function";
  readonly sourceDeclaration: Node;
  readonly fileName: string;
  readonly name: string;
  readonly carrier: TargetTypeRef;
  readonly parameterCarriers: readonly TargetTypeRef[];
  readonly argumentModes: readonly RustArgumentMode[];
  readonly resultCarrier: TargetTypeRef;
}

export const rustSourceCallableValueFactKey: RustPlanKey<RustSourceCallableValueFact> = defineRustPlanKey(
  "sourceCallableValue",
  (left, right) => left.form === right.form &&
    left.sourceDeclaration === right.sourceDeclaration &&
    left.fileName === right.fileName &&
    left.name === right.name &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.parameterCarriers.length === right.parameterCarriers.length &&
    left.parameterCarriers.every((carrier, index) =>
      rustTargetTypeRefEquals(carrier, right.parameterCarriers[index])) &&
    left.argumentModes.length === right.argumentModes.length &&
    left.argumentModes.every((mode, index) => mode === right.argumentModes[index]) &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier),
);

export interface RustModuleBindingFact {
  readonly declarationKind: "const" | "let" | "var";
  readonly storage: "native-const" | "module-cell";
  readonly valueCarrier: TargetTypeRef;
}

export const rustModuleBindingFactKey: RustPlanKey<RustModuleBindingFact> = defineRustPlanKey(
  "moduleBinding",
  (left, right) => left.declarationKind === right.declarationKind &&
    left.storage === right.storage &&
    rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier),
);

function rustTypedLocationPlanEquals(
  left: RustTypedLocationPlan,
  right: RustTypedLocationPlan,
): boolean {
  if (left.operation !== right.operation || left.call !== right.call ||
    !rustTargetTypeRefEquals(left.pointeeCarrier, right.pointeeCarrier) ||
    !rustTargetTypeRefEquals(left.locationCarrier, right.locationCarrier)) {
    return false;
  }
  switch (left.operation) {
    case "address-of":
      return right.operation === "address-of" &&
        left.storageExpression === right.storageExpression &&
        left.storageDeclaration === right.storageDeclaration &&
        left.rootExpression === right.rootExpression &&
        left.rootDeclaration === right.rootDeclaration &&
        left.locationIdentity === right.locationIdentity;
    case "allocate":
      return right.operation === "allocate" &&
        left.initialExpression === right.initialExpression &&
        left.locationIdentity === right.locationIdentity;
    case "load":
      return right.operation === "load" &&
        left.pointerExpression === right.pointerExpression;
    case "store":
      return right.operation === "store" &&
        left.pointerExpression === right.pointerExpression &&
        left.valueExpression === right.valueExpression;
    case "equal-pointer":
      return right.operation === "equal-pointer" &&
        left.leftExpression === right.leftExpression &&
        left.rightExpression === right.rightExpression;
  }
}


export type RustOptionProjectionFact =
  | {
      readonly kind: "none";
      readonly sourceCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "some";
      readonly sourceCarrier: TargetTypeRef;
      readonly elementCarrier: TargetTypeRef;
      readonly resultCarrier: TargetTypeRef;
    };

export const rustOptionProjectionFactKey: RustPlanKey<RustOptionProjectionFact> =
  defineRustPlanKey("optionProjection", closedMetadataEquals);

export type RustFlowReadProjectionFact =
  | {
      readonly kind: "option-value";
      readonly sourceCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "project-downcast";
      readonly sourceCarrier: TargetTypeRef;
      readonly dispatchCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "program-error-variant";
      readonly sourceCarrier: TargetTypeRef;
      readonly selectedCarrier: TargetTypeRef;
      readonly variant: string;
    };

export const rustFlowReadProjectionFactKey: RustPlanKey<RustFlowReadProjectionFact> =
  defineRustPlanKey("flowReadProjection", (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.selectedCarrier, right.selectedCarrier) &&
    (left.kind !== "project-downcast" ||
      (right.kind === "project-downcast" &&
        rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier))) &&
    (left.kind !== "program-error-variant" ||
      (right.kind === "program-error-variant" && left.variant === right.variant)));

export interface RustContextualValueConversionFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly conversion: RustValueConversion;
}

export const rustContextualValueConversionFactKey: RustPlanKey<RustContextualValueConversionFact> =
  defineRustPlanKey("contextualValueConversion", closedMetadataEquals);

export interface RustProjectUpcastFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

export const rustProjectUpcastFactKey: RustPlanKey<RustProjectUpcastFact> =
  defineRustPlanKey("projectUpcast", (left, right) =>
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier));

export interface RustProjectDowncastFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly dispatchCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

export const rustProjectDowncastFactKey: RustPlanKey<RustProjectDowncastFact> =
  defineRustPlanKey("projectDowncast", (left, right) =>
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.dispatchCarrier, right.dispatchCarrier) &&
    rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier));

export type RustSourceBindingFact =
  | {
      readonly scope: "lexical";
      readonly sourceName: string;
      readonly sourceDeclaration: Node;
    }
  | {
      readonly scope: "module";
      readonly sourceName: string;
      readonly fileName: string;
      readonly sourceDeclaration: Node;
    };

export const rustSourceBindingFactKey: RustPlanKey<RustSourceBindingFact> =
  defineRustPlanKey("sourceBinding", (left, right) =>
    left.scope === right.scope &&
    left.sourceName === right.sourceName &&
    left.sourceDeclaration === right.sourceDeclaration &&
    (left.scope !== "module" ||
      (right.scope === "module" && left.fileName === right.fileName)));

export type RustBindingProjection =
  | {
      readonly kind: "object-field";
      readonly storage: "project-object" | "object-handle";
      readonly storageIndex: number;
    }
  | {
      readonly kind: "object-rest";
      readonly storage: "project-object" | "object-handle";
      readonly fields: readonly {
        readonly sourceStorageIndex: number;
        readonly targetStorageIndex: number;
        readonly carrier: TargetTypeRef;
      }[];
    }
  | { readonly kind: "tuple-element"; readonly index: number }
  | { readonly kind: "fixed-array-element"; readonly index: number }
  | { readonly kind: "vec-element"; readonly index: number; readonly checked: boolean }
  | { readonly kind: "js-array-element"; readonly index: number }
  | { readonly kind: "tuple-rest"; readonly start: number }
  | { readonly kind: "fixed-array-rest"; readonly start: number }
  | { readonly kind: "vec-rest"; readonly start: number }
  | { readonly kind: "js-array-rest"; readonly start: number };

export type RustBindingNormalization =
  | "identity"
  | "expect-some"
  | "flatten-option"
  | "default-on-none"
  | "flatten-expect-some"
  | "flatten-default-on-none";

export interface RustBindingProjectionFact {
  readonly sourceCarrier: TargetTypeRef;
  readonly projectedCarrier: TargetTypeRef;
  readonly bindingCarrier: TargetTypeRef;
  readonly projection: RustBindingProjection;
  readonly normalization: RustBindingNormalization;
}

export const rustBindingProjectionFactKey: RustPlanKey<RustBindingProjectionFact> =
  defineRustPlanKey("bindingProjection", (left, right) =>
    rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.projectedCarrier, right.projectedCarrier) &&
    rustTargetTypeRefEquals(left.bindingCarrier, right.bindingCarrier) &&
    closedMetadataEquals(left.projection, right.projection) &&
    left.normalization === right.normalization);

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

export type RustTypeAliasDeclarationFact =
  | {
      readonly kind: "string-literal";
      readonly variants: readonly {
        readonly name: string;
        readonly literal: string;
      }[];
    }
  | {
      readonly kind: "runtime";
      readonly variants: readonly {
        readonly name: string;
        readonly carrier: TargetTypeRef;
      }[];
    }
  | { readonly kind: "erased" };

export const rustTypeAliasDeclarationFactKey: RustPlanKey<RustTypeAliasDeclarationFact> =
  defineRustPlanKey("typeAliasDeclaration", closedMetadataEquals);

export interface RustAsyncFunctionFact {
  readonly isAsync: true;
  readonly outputCarrier: TargetTypeRef;
}

export const rustAsyncFunctionFactKey: RustPlanKey<RustAsyncFunctionFact> =
  defineRustPlanKey("asyncFunction", closedMetadataEquals);

export interface RustGeneratorFact {
  readonly kind: "sync" | "async";
  readonly carrier: TargetTypeRef;
  readonly yieldType: TargetTypeRef;
  readonly returnType: TargetTypeRef;
  readonly nextType: TargetTypeRef;
}

export const rustGeneratorFactKey: RustPlanKey<RustGeneratorFact> =
  defineRustPlanKey("generator", (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.returnType, right.returnType) &&
    rustTargetTypeRefEquals(left.nextType, right.nextType));

export interface RustYieldFact {
  readonly generatorDeclaration: Node;
  readonly kind: "value" | "delegate";
  readonly yieldType: TargetTypeRef;
  readonly resultType: TargetTypeRef;
  readonly delegatedCarrier?: TargetTypeRef;
}

export const rustYieldFactKey: RustPlanKey<RustYieldFact> =
  defineRustPlanKey("yield", (left, right) =>
    left.generatorDeclaration === right.generatorDeclaration &&
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.resultType, right.resultType) &&
    (left.delegatedCarrier === undefined
      ? right.delegatedCarrier === undefined
      : right.delegatedCarrier !== undefined &&
        rustTargetTypeRefEquals(left.delegatedCarrier, right.delegatedCarrier)));

export type RustResourceDisposalTarget =
  | {
      readonly form: "source-method";
      readonly name: "dispose" | "dispose_async";
      readonly receiverMode: "ref" | "mut-ref";
    }
  | {
      readonly form: "provider";
      readonly target: RustProviderOperationForm;
    };

export interface RustResourceManagementFact {
  readonly declarationKind: "using" | "await using";
  readonly storageCarrier: TargetTypeRef;
  readonly resourceCarrier: TargetTypeRef;
  readonly nullable: boolean;
  readonly disposal: {
    readonly kind: "sync" | "async";
    readonly fallible: boolean;
    readonly target: RustResourceDisposalTarget;
  };
}

export const rustResourceManagementFactKey: RustPlanKey<RustResourceManagementFact> =
  defineRustPlanKey("resourceManagement", closedMetadataEquals);

export interface RustSourceParameterAbiFact {
  readonly form: "required" | "optional" | "default" | "rest";
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
}

export const rustSourceParameterAbiFactKey: RustPlanKey<RustSourceParameterAbiFact> =
  defineRustPlanKey("sourceParameterAbi", closedMetadataEquals);

export interface RustSourceCallableReturnFact {
  readonly returnCarrier: TargetTypeRef;
}

export const rustSourceCallableReturnFactKey: RustPlanKey<RustSourceCallableReturnFact> =
  defineRustPlanKey("sourceCallableReturn", (left, right) =>
    rustTargetTypeRefEquals(left.returnCarrier, right.returnCarrier));

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

export interface RustSourceAccessorEffectsFact {
  readonly read?: "infallible" | "fallible";
  readonly write?: "infallible" | "fallible";
}

export const rustSourceAccessorEffectsFactKey: RustPlanKey<RustSourceAccessorEffectsFact> =
  defineRustPlanKey("sourceAccessorEffects", closedMetadataEquals);

export interface RustFutureValueFact {
  readonly outputCarrier: TargetTypeRef;
  readonly awaitedConversion: RustFinalizedValueConversion;
  readonly awaiting: "infallible" | "fallible";
  readonly errorBoundary: "none" | "provider-native" | "source-program";
}

// Exact await behavior for one first-class future value. Unlike its runtime
// carrier, this fact preserves operation-specific rejection and result-
// conversion semantics while the value flows through immutable bindings.
export const rustFutureValueFactKey: RustPlanKey<RustFutureValueFact> =
  defineRustPlanKey("futureValue", closedMetadataEquals);

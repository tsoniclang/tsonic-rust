import type { Node } from "@tsonic/tsts";
import type { RustArgumentMode, RustProviderFactOperationKind, RustRuntimeSetOperationKind, RustSourceCallParameterPlan, RustValueConversion } from "../../../policy/operations/model.js";
import type { RustFinalizedOperationAbiFor } from "../finalized-operation-abi.js";
import type { RustOperationSymbol, RustOperatorToken } from "../../../backend/model/syntax.js";
import type { TargetTypeRef } from "../../../policy/types/model.js";

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
      readonly sourceResultCarrier?: TargetTypeRef;
      readonly sourceAbsenceCarrier?: TargetTypeRef;
      readonly abi: RustFinalizedOperationAbiFor<RustProviderFactOperationKind>;
    }
  | {
      readonly kind: "default-value";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "object-shape-projection";
      readonly operationId: string;
      readonly projection: "keys" | "values" | "entries" | "has-own";
      readonly sourceValue: Node;
      readonly sourceValueOrigin:
        | { readonly kind: "receiver" }
        | { readonly kind: "argument"; readonly index: number };
      readonly sourceValueCarrier: TargetTypeRef;
      readonly keyExpression?: Node;
      readonly fields: readonly {
        readonly sourceName: string;
        readonly storageIndex: number;
        readonly valueCarrier: TargetTypeRef;
        readonly accessor?: {
          readonly getter: true;
          readonly setter: boolean;
        };
        readonly method?: true;
        readonly conversion?: RustValueConversion;
      }[];
      readonly storage: "project-object" | "object-handle";
      readonly resultCarrier: TargetTypeRef;
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
      readonly optionCarrier: TargetTypeRef;
      readonly nullishCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "option-equality";
      readonly operationId: string;
      readonly negated: boolean;
      readonly optionCarrier: TargetTypeRef;
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
      readonly declaration?: Node;
      readonly accessMode: "read" | "write" | "read-write";
      readonly receiverCarrier: TargetTypeRef;
      readonly storage: "project-object" | "object-handle";
      readonly storageIndex: number;
      readonly valueSemantics:
        | { readonly kind: "stored" }
        | { readonly kind: "accessor"; readonly writable: boolean }
        | { readonly kind: "method" };
      readonly resultCarrier: TargetTypeRef;
      readonly dispatch?: {
        readonly read: string;
        readonly write: string;
        readonly ownerCarrier: TargetTypeRef;
      };
    }
  | {
      readonly kind: "source-index-signature";
      readonly operationId: string;
      readonly receiverCarrier: TargetTypeRef;
      readonly keyCarrier: TargetTypeRef;
      readonly storageName: string;
      readonly writable: boolean;
      readonly resultCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "source-method-property";
      readonly operationId: string;
      readonly declaration: Node;
      readonly receiverCarrier: TargetTypeRef;
      readonly callableCarrier: TargetTypeRef;
      readonly write?: {
        readonly dispatchSlot: string;
        readonly ownerCarrier: TargetTypeRef;
        readonly storageName?: string;
      };
      readonly resultCarrier: TargetTypeRef;
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
        readonly declaration: Node;
        readonly method: string;
        readonly resultCarrier: TargetTypeRef;
      };
      readonly write?: {
        readonly declaration: Node;
        readonly method: string;
        readonly valueCarrier: TargetTypeRef;
      };
      readonly dispatch?: {
        readonly ownerCarrier: TargetTypeRef;
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
          readonly valueSemantics:
            | { readonly kind: "stored" }
            | { readonly kind: "accessor"; readonly writable: boolean }
            | { readonly kind: "method" };
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
        | {
            readonly form: "function";
            readonly fileName: string;
            readonly name: string;
            readonly selectedTargetName: string;
          }
        | {
            readonly form: "method";
            readonly name: string;
            readonly mutatesSelf: boolean;
            readonly dispatch?: {
              readonly selected: "virtual" | "exact";
              readonly ownerCarrier: TargetTypeRef;
            };
          }
        | { readonly form: "static-method"; readonly name: string; readonly typeCarrier: TargetTypeRef }
        | { readonly form: "callable"; readonly carrier: TargetTypeRef }
        | {
            readonly form: "structural-method";
            readonly receiverCarrier: TargetTypeRef;
            readonly storageIndex: number;
            readonly callableCarrier: TargetTypeRef;
          }
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
        readonly implementationDeclaration?: Node;
        readonly contractDeclarations: readonly Node[];
        readonly sourceName: string;
        readonly storageIndex: number;
        readonly carrier: TargetTypeRef;
        readonly presence: "required" | "optional";
        readonly readonly: boolean;
        readonly accessor?: {
          readonly getter: true;
          readonly setter: boolean;
        };
        readonly method?: true;
      }[];
      readonly contributions: readonly (
        | {
            readonly kind: "property";
            readonly property: Node;
            readonly sourceName: string;
            readonly targetStorageIndex: number;
          }
        | {
            readonly kind: "method";
            readonly property: Node;
            readonly expression: Node;
            readonly contractDeclarations: readonly Node[];
          }
        | {
            readonly kind: "structural-method";
            readonly property: Node;
            readonly expression: Node;
            readonly sourceName: string;
            readonly targetStorageIndex: number;
          }
        | {
            readonly kind: "accessor";
            readonly property: Node;
            readonly sourceName: string;
            readonly targetStorageIndex: number;
            readonly role: "get" | "set";
          }
        | {
            readonly kind: "spread";
            readonly property: Node;
            readonly expression: Node;
            readonly sourceStorage: "project-object" | "object-handle";
            readonly sourceCarrier: TargetTypeRef;
            readonly fields: readonly {
              readonly sourceName: string;
            readonly sourceStorageIndex: number;
            readonly targetStorageIndex: number;
            readonly carrier: TargetTypeRef;
            readonly accessor?: {
              readonly getter: true;
              readonly setter: boolean;
            };
            readonly method?: true;
            }[];
            readonly methods: readonly {
              readonly contractDeclaration: Node;
              readonly sourceDeclaration: Node;
              readonly callableCarrier: TargetTypeRef;
            }[];
          }
      )[];
    }
  | {
      readonly kind: "record-index-literal";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
      readonly keyCarrier: TargetTypeRef;
      readonly valueCarrier: TargetTypeRef;
      readonly storageName: string;
      readonly contributions: readonly (
        | {
            readonly kind: "property";
            readonly property: Node;
            readonly sourceName: string;
            readonly expression: Node;
          }
        | {
            readonly kind: "spread";
            readonly property: Node;
            readonly expression: Node;
            readonly sourceCarrier: TargetTypeRef;
            readonly sourceStorageName: string;
          }
      )[];
    }
  | { readonly kind: "fixed-array-literal"; readonly operationId: string }
  | { readonly kind: "fixed-index"; readonly operationId: string; readonly index: number }
  | {
      readonly kind: "tuple-literal";
      readonly operationId: string;
      readonly resultCarrier: TargetTypeRef;
      readonly omittedOptionalElementIndexes: readonly number[];
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
      readonly parameterForms: "required-only" | "source";
      readonly byRefCopyParams: readonly boolean[];
      readonly leadingParameters?: readonly {
        readonly kind: "this" | "receiver";
        readonly carrier: TargetTypeRef;
      }[];
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
    case "default-value":
    case "object-shape-projection":
    case "operator-token":
    case "operator-call":
    case "string-concat":
    case "template-string":
    case "typeof":
    case "void-expression":
    case "array-literal":
    case "source-field":
    case "source-index-signature":
    case "source-method-property":
    case "source-static-field":
    case "source-accessor":
    case "source-union-field":
    case "source-call":
    case "source-enum-member":
    case "record-literal":
    case "record-index-literal":
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
    case "option-equality":
    case "option-value-equality":
      return { kind: "source-primitive", name: "bool" };
    default:
      return undefined;
  }
}

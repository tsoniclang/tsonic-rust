import type {
  ArgumentPassingMode,
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  Signature,
  SourcePrimitiveKind,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

export type RustTargetTypeRef =
  | { readonly kind: "source-primitive"; readonly name: SourcePrimitiveKind }
  | { readonly kind: "target-named"; readonly id: string; readonly typeArguments?: readonly RustTargetTypeRef[] }
  | { readonly kind: "type-parameter"; readonly name: string }
  | { readonly kind: "array"; readonly element: RustTargetTypeRef; readonly rank?: number }
  | { readonly kind: "slice"; readonly element: RustTargetTypeRef }
  | { readonly kind: "tuple"; readonly elements: readonly RustTargetTypeRef[] }
  | { readonly kind: "reference"; readonly referent: RustTargetTypeRef; readonly mutable: boolean; readonly lifetime?: string }
  | { readonly kind: "pointer"; readonly pointee: RustTargetTypeRef; readonly mutability?: "const" | "mut" | "target-defined" }
  | { readonly kind: "function-pointer"; readonly args: readonly RustTargetTypeRef[]; readonly result: RustTargetTypeRef; readonly abi?: readonly string[]; readonly isUnsafe?: boolean }
  | { readonly kind: "closure"; readonly args: readonly RustTargetTypeRef[]; readonly result: RustTargetTypeRef }
  | { readonly kind: "opaque"; readonly id: string }
  | { readonly kind: "associated-type"; readonly owner: RustTargetTypeRef; readonly name: string }
  | { readonly kind: "lifetime"; readonly name: string }
  | { readonly kind: "target-specific"; readonly target: "rust"; readonly name: string; readonly value?: unknown };

export type TargetTypeRef = RustTargetTypeRef;

export interface RustTargetParameter {
  readonly name: string;
  readonly type: RustTargetTypeRef;
  readonly passingMode: ArgumentPassingMode;
  readonly optional?: boolean;
  readonly paramsArray?: boolean;
}

export interface RustTargetTypeParameter {
  readonly name: string;
}

export interface RustTargetMember {
  readonly id: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly kind: "method" | "constructor" | "property" | "field" | "indexer" | "event" | "operator";
  readonly static?: boolean;
  readonly parameters: readonly RustTargetParameter[];
  readonly returnType?: RustTargetTypeRef;
  readonly typeParameters?: readonly RustTargetTypeParameter[];
  readonly providerDeclaration?: ProviderDeclarationIdentity;
}

export interface RustTargetCallArgumentSlot {
  readonly sourceArgumentIndex: number;
  readonly sourceForm: "value" | "spread-element" | "spread-sequence";
  readonly spreadElementIndex?: number;
  readonly targetParameterIndex: number;
  readonly targetForm: "parameter" | "params-element" | "params-sequence";
}

export interface RustSelectedTargetSignature {
  readonly member: RustTargetMember;
  readonly sourceSelectedReceiverCarrier?: RustTargetTypeRef;
  readonly targetTypeArguments?: readonly RustTargetTypeRef[];
  readonly providerDeclaration?: ProviderDeclarationIdentity;
  readonly argumentConversions?: readonly RustTargetCallArgumentSlot[];
  readonly sourceSignature?: Signature;
  readonly sourceDeclaration?: Node;
  readonly sourceCalleeSymbol?: Symbol;
  readonly sourceCalleeDeclaration?: Node;
  readonly sourceReturnType?: Type;
  readonly sourceArgumentBindings?: NonNullable<
    ReturnType<SourceFileSemantics["getResolvedCallInfo"]>
  >["sourceArgumentBindings"];
  readonly sourceSelectedSignatureParameters?: NonNullable<
    ReturnType<SourceFileSemantics["getResolvedCallInfo"]>
  >["sourceSelectedSignatureParameters"];
  readonly sourceSelectedMethodTypeArguments?: NonNullable<
    ReturnType<SourceFileSemantics["getResolvedCallInfo"]>
  >["sourceSelectedMethodTypeArguments"];
}

export interface RustSelectedTargetOperation {
  readonly operationId: string;
  readonly operationKind: "property" | "method" | "indexer" | "operator" | "constructor" | "iteration";
  readonly targetOperation: string;
  readonly resultType?: RustTargetTypeRef;
  readonly providerDeclaration?: ProviderDeclarationIdentity;
  readonly provenance?: {
    readonly sourceExpression?: ExtensionFactSubject;
    readonly sourceReceiver?: ExtensionFactSubject;
    readonly sourceCallee?: ExtensionFactSubject;
    readonly sourceSelectedSignature?: ExtensionFactSubject;
    readonly sourceSelectedSymbol?: ExtensionFactSubject;
    readonly sourceSelectedDeclaration?: ExtensionFactSubject;
    readonly sourceSelectedReadDeclaration?: Node;
    readonly sourceSelectedWriteDeclaration?: Node;
    readonly sourceCalleeSymbol?: ExtensionFactSubject;
    readonly sourceCalleeDeclaration?: ExtensionFactSubject;
    readonly sourceResultType?: ExtensionFactSubject;
    readonly sourceReturnType?: ExtensionFactSubject;
    readonly providerDeclaration?: ProviderDeclarationIdentity;
  };
}

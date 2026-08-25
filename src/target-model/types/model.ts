import type {
  ArgumentPassingMode,
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  ResolvedSourceCallInfo,
  Signature,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type {
  RustGenericArgument,
  RustGenerics,
  RustConditionalTraitRequirement,
  RustTraitImplementationEvidence,
  RustTypeRef,
} from "../semantics/index.js";

export type RustTargetTypeRef = RustTypeRef;

export type TargetTypeRef = RustTargetTypeRef;

export type RustNamedTypeTraitRequirement = RustConditionalTraitRequirement;

export type RustNamedTypeTraitImplementation = RustTraitImplementationEvidence;

export interface RustNamedTypeTraitContract {
  readonly implementations: readonly RustNamedTypeTraitImplementation[];
}

export interface RustTargetParameter {
  readonly name: string;
  readonly type: RustTargetTypeRef;
  readonly passingMode: ArgumentPassingMode;
  readonly optional?: boolean;
  readonly paramsArray?: boolean;
}

export interface RustTargetMember {
  readonly id: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly kind: "method" | "constructor" | "property" | "field" | "indexer" | "event" | "operator";
  readonly static?: boolean;
  readonly parameters: readonly RustTargetParameter[];
  readonly returnType?: RustTargetTypeRef;
  readonly generics: RustGenerics;
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
  readonly sourceCallableCarrier?: RustTargetTypeRef;
  readonly sourceCallableParameterIndexes?: readonly number[];
  readonly sourceStructuralMethod?: {
    readonly receiverCarrier: RustTargetTypeRef;
    readonly storageIndex: number;
  };
  readonly targetGenericArguments?: readonly RustGenericArgument[];
  readonly providerDeclaration?: ProviderDeclarationIdentity;
  readonly argumentConversions?: readonly RustTargetCallArgumentSlot[];
  readonly sourceSignature?: Signature;
  readonly sourceDeclaration?: Node;
  readonly sourceCalleeSymbol?: Symbol;
  readonly sourceCalleeDeclaration?: Node;
  readonly sourceReturnType?: Type;
  readonly sourceArgumentBindings?: ResolvedSourceCallInfo["sourceArgumentBindings"];
  readonly sourceSelectedSignatureParameters?: ResolvedSourceCallInfo["sourceSelectedSignatureParameters"];
  readonly sourceSelectedMethodTypeArguments?: ResolvedSourceCallInfo["sourceSelectedMethodTypeArguments"];
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

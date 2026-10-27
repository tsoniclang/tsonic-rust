import type { ExtensionFactSubject, Node, ProviderDeclarationIdentity, ResolvedSourceCallInfo, Signature, Symbol, Type } from "@tsonic/tsts";

import type { RustValueConversion } from "../../operations/model.js";
import type { RustFlowReadProjectionFact } from "../objects/value-projections.js";

import type { RustTargetMember, RustTargetTypeRef, RustTargetGenericArgument } from "../../types/model.js";
export interface RustTargetCallArgumentSlot {
  readonly sourceArgumentIndex: number;
  readonly sourceForm: "value" | "spread-element" | "spread-sequence";
  readonly spreadElementIndex?: number;
  readonly targetParameterIndex: number;
  readonly targetForm: "parameter" | "params-element" | "params-sequence";
}

export interface RustSelectedTargetSignature {
  readonly member: RustTargetMember;
  readonly nativeParameterDeclarations: readonly (Node | undefined)[];
  readonly sourceResultProjection?: RustFlowReadProjectionFact;
  readonly sourceUnionMethods?: {
    readonly receiverCarrier: RustTargetTypeRef;
    readonly variants: readonly RustSelectedUnionMethod[];
  };
  readonly sourceSelectedReceiverCarrier?: RustTargetTypeRef;
  readonly sourceSelectedOwnerCarrier?: RustTargetTypeRef;
  readonly sourceCallableCarrier?: RustTargetTypeRef;
  readonly sourceCallableParameterIndexes?: readonly number[];
  readonly sourceConstructorCarrier?: RustTargetTypeRef;
  readonly sourceStructuralMethod?: {
    readonly receiverCarrier: RustTargetTypeRef;
    readonly storageIndex: number;
  };
  readonly targetGenericArguments?: readonly RustTargetGenericArgument[];
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

export interface RustSelectedUnionMethodIdentity {
  readonly name: string;
  readonly carrier: RustTargetTypeRef;
  readonly declaration: Node;
  readonly targetName: string;
}

export interface RustSelectedUnionMethod extends RustSelectedUnionMethodIdentity {
  readonly returnType: RustTargetTypeRef;
  readonly resultConversion: RustValueConversion | undefined;
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

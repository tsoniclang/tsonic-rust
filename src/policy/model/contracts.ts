import type { ExtensionFactSubject, Node, ProviderDeclarationIdentity, ResolvedSourceIterationInfo, Symbol, Type, TypeIndexInfo } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

import type { RustTargetParameter, TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetOperation, RustSelectedTargetSignature, RustTargetCallArgumentSlot } from "../../target-model/records/operations/member-selections.js";
import type { RustCallbackOperationTemplate, RustProviderOperationTemplate } from "../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";

type ResolvedSourceCallInfo = NonNullable<
  ReturnType<SourceFileSemantics["operations"]["call"]>
>;

type ResolvedSourcePropertyAccessInfo = NonNullable<
  ReturnType<SourceFileSemantics["operations"]["propertyAccess"]>
>;

export type RustPolicySelection<T> =
  | { readonly kind: "accept"; readonly value: T; readonly evidence?: readonly RustPolicyEvidence[] }
  | { readonly kind: "reject"; readonly diagnostic: RustPolicyDiagnostic };

export interface RustPolicyEvidence {
  readonly message: string;
}

export interface RustPolicyDiagnostic {
  readonly extensionId: string;
  readonly extensionCode: string;
  readonly numericCode: number;
  readonly category: "error" | "warning" | "suggestion";
  readonly message: string;
  readonly nodeOrSpan?: ExtensionFactSubject;
  readonly evidence?: readonly RustPolicyEvidence[];
}

export function acceptRustPolicy<T>(
  value: T,
  evidence?: readonly RustPolicyEvidence[],
): RustPolicySelection<T> {
  return evidence === undefined
    ? { kind: "accept", value }
    : { kind: "accept", value, evidence };
}

export function rejectRustPolicy<T>(
  diagnostic: RustPolicyDiagnostic,
): RustPolicySelection<T> {
  return { kind: "reject", diagnostic };
}

export interface RustCheckedCallSelectionInput {
  readonly target?: "rust";
  readonly source: ResolvedSourceCallInfo;
  readonly sourceSelectedDeclaration?: Node;
}

export interface RustCheckedValueSelectionInput {
  readonly target?: "rust";
  readonly expression: Node;
  readonly sourceSelectedSymbol?: Symbol;
  readonly sourceSelectedDeclaration?: Node;
}

export type RustCheckedValueSelectionResult =
  | { readonly kind: "source"; readonly operation?: undefined; readonly targetFact?: undefined }
  | RustCheckedOperationSelectionResult;

export type RustCheckedCallSelectionResult =
  | { readonly kind: "source"; readonly operation?: undefined; readonly targetFact?: undefined }
  | {
      readonly kind: "deferred-callback";
      readonly operation?: undefined;
      readonly targetFact?: undefined;
      readonly callback: RustCallbackOperationTemplate;
      readonly sourceName: string;
      readonly providerDeclaration?: ProviderDeclarationIdentity;
      readonly template: RustProviderOperationTemplate;
      readonly parameterCarriers: readonly (TargetTypeRef | undefined)[];
    }
  | {
      readonly kind?: "target";
      readonly operation?: RustTargetOperationSelection;
      readonly selectedSignature: RustSelectedTargetSignature;
      readonly targetFact?: RustTargetOperationFact;
      readonly sourceGuard?: {
        readonly guard: Node;
        readonly sourceGuardCarrier: TargetTypeRef;
      };
      readonly argumentConversions?: readonly RustTargetCallArgumentSlot[];
    };

export interface RustCheckedPropertySelectionInput {
  readonly target?: "rust";
  readonly expression: Node;
  readonly receiver: Node;
  readonly sourceReceiverType?: Type;
  readonly sourceReceiverDeclaration?: Node;
  readonly sourceReceiverValueDeclaration?: Node;
  readonly sourceReceiverIntrinsic?: ResolvedSourcePropertyAccessInfo["receiver"]["intrinsic"];
  readonly accessMode: ResolvedSourcePropertyAccessInfo["accessMode"];
  readonly sourceSelectedSymbol?: Symbol;
  readonly sourceSelectedDeclaration?: Node;
  readonly sourceSelectedReadDeclaration?: Node;
  readonly sourceSelectedWriteDeclaration?: Node;
  readonly sourceSelectedIndex?: TypeIndexInfo;
  readonly sourceReadType?: Type;
  readonly sourceWriteType?: Type;
  readonly sourceResultType?: Type;
  readonly optionalChain?: boolean;
}

export interface RustCheckedElementSelectionInput
  extends RustCheckedPropertySelectionInput {
  readonly argument: Node;
  readonly sourceArgumentType: Type;
  readonly sourceSelectedElementIndex?: number;
}

export interface RustCheckedDeleteSelectionInput {
  readonly target?: "rust";
  readonly expression: Node;
  readonly operand: Node;
  readonly receiver: Node;
  readonly index: Node;
  readonly sourceSelectedSymbol?: Symbol;
  readonly sourceSelectedDeclaration?: Node;
}

export interface RustCheckedOperatorSelectionInput {
  readonly target?: "rust";
  readonly expression: Node;
  readonly operator: string;
  readonly left?: Node;
  readonly right?: Node;
  readonly sourceRightDeclaration?: Node;
}

export interface RustCheckedIterationSelectionInput {
  readonly target?: "rust";
  readonly statement: Node;
  readonly expression: Node;
  readonly initializer?: Node;
  readonly source: ResolvedSourceIterationInfo;
}

export type RustCheckedConversionSelectionInput =
  | {
      readonly conversionKind: "call-argument";
      readonly expression: Node;
      readonly targetParameter: RustTargetParameter;
      readonly selectedSignature: RustSelectedTargetSignature;
      readonly parameterIndex?: number;
      readonly sourceSelectedSymbol?: Symbol;
      readonly sourceSelectedDeclaration?: Node;
    }
  | {
      readonly conversionKind: "assertion";
      readonly expression: Node;
      readonly sourceExpression: Node;
      readonly explicitTargetTypeNode: Node;
      readonly target: Type;
      readonly sourceSelectedSymbol?: Symbol;
      readonly sourceSelectedDeclaration?: Node;
    };

export interface RustCheckedConversionSelectionResult {
  readonly convertedType?: TargetTypeRef;
  readonly operation?: RustTargetOperationSelection;
  readonly targetFact?: RustTargetOperationFact;
  readonly providerDeclaration?: ProviderDeclarationIdentity;
}

export interface RustCheckedOperationSelectionResult {
  readonly operation: RustTargetOperationSelection;
  readonly targetFact?: RustTargetOperationFact;
  readonly resultType?: TargetTypeRef;
  readonly providerDeclaration?: ProviderDeclarationIdentity;
  readonly provenance?: RustTargetOperationSelection["provenance"];
}

export type RustTargetOperationSelection = RustSelectedTargetOperation;

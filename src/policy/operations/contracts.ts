import type {
  ExtensionFactSubject,
  Node,
  ProviderDeclarationIdentity,
  Signature,
  SourceFile,
  Symbol,
  Type,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetDiagnostic,
} from "@tsonic/target-api";
import type { RustSourcePolicyContext } from "../context.js";
import type {
  RustSelectedTargetOperation,
  RustSelectedTargetSignature,
  RustTargetCallArgumentSlot,
  RustTargetParameter,
  TargetTypeRef,
} from "../types.js";
import type {
  RustProviderOperationTemplate,
} from "../../source/rust-facts/keys.js";

type ResolvedSourceCallInfo = NonNullable<
  ReturnType<SourceFileSemantics["getResolvedCallInfo"]>
>;

export type RustSourceSelectedMethodTypeArguments =
  ResolvedSourceCallInfo["sourceSelectedMethodTypeArguments"];

export interface RustOperationPolicyContext extends RustSourcePolicyContext {
  readonly currentSourceFile: SourceFile;
  readonly sourceFiles: readonly SourceFile[];
  readonly checker: SourceFileSemantics;
  readonly typeShape: SourceFileSemantics;
  readonly extensionId: "tsonic.rust.policy";
}

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

export function rustPolicyTargetDiagnostic(
  diagnostic: RustPolicyDiagnostic,
): TargetDiagnostic {
  return {
    code: diagnostic.extensionCode,
    category: diagnostic.category,
    source: "tsonic-rust",
    message: diagnostic.message,
    ...(diagnostic.nodeOrSpan === undefined
      ? {}
      : { sourceNode: diagnostic.nodeOrSpan as Node }),
    ...(diagnostic.evidence === undefined
      ? {}
      : { evidence: diagnostic.evidence.map((entry) => entry.message) }),
  };
}

export interface RustCheckedCallSelectionInput {
  readonly target?: "rust";
  readonly call: Node;
  readonly callee: Node;
  readonly arguments: readonly Node[];
  readonly sourceArgumentBindings: ResolvedSourceCallInfo["sourceArgumentBindings"];
  readonly sourceSelectedSignatureParameters: ResolvedSourceCallInfo["sourceSelectedSignatureParameters"];
  readonly sourceReceiver?: ResolvedSourceCallInfo["sourceReceiver"];
  readonly sourceCalleeAccess?: ResolvedSourceCallInfo["sourceCalleeAccess"];
  readonly sourceSelectedSignature?: Signature;
  readonly sourceSelectedDeclaration?: Node;
  readonly sourceCalleeSymbol?: Symbol;
  readonly sourceCalleeDeclaration?: Node;
  readonly sourceReturnType?: Type;
  readonly sourceSelectedMethodTypeArguments?: RustSourceSelectedMethodTypeArguments;
}

export type RustCheckedCallSelectionResult =
  | { readonly kind: "source" }
  | {
      readonly kind: "deferred-callback";
      readonly callbackShape: "map" | "reduce";
      readonly sourceName: string;
      readonly template: RustProviderOperationTemplate;
      readonly parameterCarriers: readonly (TargetTypeRef | undefined)[];
    }
  | {
      readonly kind?: "target";
      readonly selectedSignature: RustSelectedTargetSignature;
      readonly argumentConversions?: readonly RustTargetCallArgumentSlot[];
    };

export interface RustCheckedPropertySelectionInput {
  readonly target?: "rust";
  readonly expression: Node;
  readonly receiver: Node;
  readonly sourceSelectedSymbol?: Symbol;
  readonly sourceSelectedDeclaration?: Node;
  readonly sourceResultType?: Type;
  readonly optionalChain?: boolean;
}

export interface RustCheckedElementSelectionInput
  extends RustCheckedPropertySelectionInput {
  readonly argument: Node;
  readonly sourceSelectedElementIndex?: number;
}

export interface RustCheckedOperatorSelectionInput {
  readonly target?: "rust";
  readonly expression: Node;
  readonly operator: string;
  readonly left?: Node;
  readonly right?: Node;
}

export interface RustCheckedIterationSelectionInput {
  readonly target?: "rust";
  readonly statement: Node;
  readonly expression: Node;
  readonly initializer?: Node;
  readonly kind: "for-in" | "for-of" | "for-await-of";
  readonly sourceElementType?: Type;
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
  readonly providerDeclaration?: ProviderDeclarationIdentity;
}

export interface RustCheckedOperationSelectionResult {
  readonly operation: RustTargetOperationSelection;
  readonly resultType?: TargetTypeRef;
  readonly providerDeclaration?: ProviderDeclarationIdentity;
  readonly provenance?: RustTargetOperationSelection["provenance"];
}

export type RustTargetOperationSelection = RustSelectedTargetOperation;

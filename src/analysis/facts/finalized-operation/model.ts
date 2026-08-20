import type {
  RustArgumentMode,
  RustFinalizedOperationKind,
  RustProviderConstantArgument,
  RustProviderOperationForm,
  RustValueConversion,
} from "../../../policy/operations/model.js";
import type { RustErrorBoundary, RustFallibleErrorBoundary } from "../../../policy/operations/error-boundary.js";
import type { TargetTypeRef } from "../../../policy/types/model.js";

export type RustFinalizedSourceArgumentRole = "parameter" | "index" | "compile-time";

export interface RustFinalizedSourceArgument {
  readonly sourceIndex: number;
  readonly carrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
  readonly role: RustFinalizedSourceArgumentRole;
  readonly disposition: "runtime" | "compile-time";
}

export type RustFinalizedValueConversion =
  | {
      readonly kind: "identity";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly fallible: false;
    }
  | {
      readonly kind: "semantic";
      readonly conversion: RustValueConversion;
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly fallible: boolean;
    };

export interface RustFinalizedSourceInput {
  readonly source: { readonly kind: "receiver" } | { readonly kind: "argument"; readonly sourceIndex: number };
  readonly sourceCarrier: TargetTypeRef;
  readonly conversion: RustFinalizedValueConversion;
  readonly mode: RustArgumentMode;
  readonly parameterCarrier: TargetTypeRef;
}

export interface RustFinalizedSliceInput {
  readonly source: { readonly kind: "argument-slice"; readonly sourceIndexes: readonly number[] };
  readonly elements: readonly RustFinalizedSourceInput[];
  readonly elementCarrier: TargetTypeRef;
  readonly mode: "ref";
  readonly parameterCarrier: TargetTypeRef;
}

export interface RustFinalizedArrayInput {
  readonly source: { readonly kind: "argument-array"; readonly sourceIndexes: readonly number[] };
  readonly elements: readonly RustFinalizedSourceInput[];
  readonly elementCarrier: TargetTypeRef;
  readonly mode: "value";
}

export interface RustFinalizedTaggedArrayInput {
  readonly source: { readonly kind: "argument-tagged-array"; readonly sourceIndexes: readonly number[] };
  readonly elements: readonly {
    readonly input: RustFinalizedSourceInput;
    readonly constructorPath: string;
  }[];
  readonly elementCarrier: TargetTypeRef;
  readonly mode: "value";
}

export interface RustFinalizedConstantInput {
  readonly source: { readonly kind: "constant"; readonly value: RustProviderConstantArgument };
}

export type RustFinalizedTargetInput = RustFinalizedSourceInput | RustFinalizedSliceInput | RustFinalizedArrayInput | RustFinalizedTaggedArrayInput | RustFinalizedConstantInput;

export type RustFinalizedOperationResult =
  | {
      readonly kind: "sync";
      readonly rawCarrier: TargetTypeRef;
      readonly conversion: RustFinalizedValueConversion;
      readonly carrier: TargetTypeRef;
    }
  | {
      readonly kind: "async";
      readonly futureCarrier: TargetTypeRef;
      readonly awaitedRawCarrier: TargetTypeRef;
      readonly awaitedConversion: RustFinalizedValueConversion;
      readonly awaitedCarrier: TargetTypeRef;
    };

export interface RustFinalizedOperationAbi {
  readonly operationKind: RustFinalizedOperationKind;
  readonly target: RustProviderOperationForm;
  readonly sourceReceiver: { readonly kind: "none" } | {
    readonly kind: "receiver";
    readonly carrier: TargetTypeRef;
    readonly disposition: "runtime" | "compile-time";
  };
  readonly sourceArguments: readonly RustFinalizedSourceArgument[];
  readonly targetReceiver: { readonly kind: "none" } | { readonly kind: "input"; readonly input: RustFinalizedSourceInput };
  readonly targetArguments: readonly RustFinalizedTargetInput[];
  readonly targetTypeArguments: readonly TargetTypeRef[];
  readonly result: RustFinalizedOperationResult;
  readonly effects: {
    readonly invocation: "infallible" | "fallible";
    readonly awaiting: "not-applicable" | "infallible" | "fallible";
    readonly errorBoundary: RustErrorBoundary;
    readonly errorCarrier?: TargetTypeRef;
    readonly safety: "safe" | "requires-unsafe";
  };
}

export type RustFinalizedOperationAbiFor<
  OperationKind extends RustFinalizedOperationKind,
> = Omit<RustFinalizedOperationAbi, "operationKind"> & {
  readonly operationKind: OperationKind;
};

export interface FinalizeRustProviderOperationAbiOptions<
  OperationKind extends RustFinalizedOperationKind = RustFinalizedOperationKind,
> {
  readonly operationKind: OperationKind;
  readonly form: RustProviderOperationForm;
  readonly sourceReceiverCarrier?: TargetTypeRef;
  readonly sourceArgumentCarriers: readonly TargetTypeRef[];
  readonly declaredSourceArgumentCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly compileTimeSourceArgumentIndexes?: readonly number[];
  readonly resultCarrier: TargetTypeRef;
  readonly targetTypeArguments?: readonly TargetTypeRef[];
  readonly resultConversion?: RustValueConversion;
  readonly isAsync: boolean;
  readonly isFallible: boolean;
  readonly errorBoundary?: RustFallibleErrorBoundary;
  readonly errorCarrier?: TargetTypeRef;
  readonly isUnsafe?: boolean;
}

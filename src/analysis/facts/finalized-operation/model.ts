import type {
  RustArgumentMode,
  RustFinalizedOperationKind,
  RustOperationEvaluationEffect,
  RustProviderConstantArgument,
  RustProviderOperationForm,
  RustValueConversion,
} from "../../../target-model/operations/model.js";
import type { RustErrorBoundary, RustFallibleErrorBoundary } from "../../../target-model/operations/error-boundary.js";
import type {
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import type { RustResolvedDispatchContextInput } from "../../../target-model/operations/dispatch-contexts.js";

export type RustFinalizedSourceArgumentRole = "parameter" | "index" | "evaluation-only";

export interface RustFinalizedSourceArgument {
  readonly sourceIndex: number;
  readonly form: "value" | "spread-sequence";
  readonly carrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
  readonly role: RustFinalizedSourceArgumentRole;
  readonly disposition: "runtime" | "evaluation-only";
}

export type RustFinalizedAtomicValueConversion =
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

export type RustFinalizedValueConversion = RustFinalizedAtomicValueConversion | {
  readonly kind: "sequence";
  readonly steps: readonly Extract<RustFinalizedAtomicValueConversion, { readonly kind: "semantic" }>[];
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

export interface RustFinalizedDispatchContextInput {
  readonly source: { readonly kind: "dispatch-context"; readonly contextId: string; readonly view: "root" | "handle" };
  readonly carrier: TargetTypeRef;
  readonly mode: "value" | "ref";
  readonly parameterCarrier: TargetTypeRef;
}

export type RustFinalizedTargetInput = RustFinalizedSourceInput | RustFinalizedSliceInput | RustFinalizedArrayInput | RustFinalizedTaggedArrayInput | RustFinalizedConstantInput | RustFinalizedDispatchContextInput;

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
    readonly declaredCarrier: TargetTypeRef;
    readonly disposition: "runtime" | "compile-time";
  };
  readonly sourceArguments: readonly RustFinalizedSourceArgument[];
  readonly targetReceiver: { readonly kind: "none" } | { readonly kind: "input"; readonly input: RustFinalizedSourceInput };
  readonly targetArguments: readonly RustFinalizedTargetInput[];
  readonly dispatchInputs: readonly RustResolvedDispatchContextInput[];
  readonly targetGenericArguments: readonly RustTargetGenericArgument[];
  readonly result: RustFinalizedOperationResult;
  readonly effects: {
    readonly evaluation: RustOperationEvaluationEffect;
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
  readonly declaredSourceReceiverCarrier?: TargetTypeRef;
  readonly sourceArgumentCarriers: readonly TargetTypeRef[];
  readonly spreadSourceArgumentIndexes?: readonly number[];
  readonly declaredSourceArgumentCarriers?: readonly (TargetTypeRef | undefined)[];
  readonly evaluationOnlySourceArgumentIndexes?: readonly number[];
  readonly resultCarrier: TargetTypeRef;
  readonly dispatchInputs?: readonly RustResolvedDispatchContextInput[];
  readonly targetGenericArguments?: readonly RustTargetGenericArgument[];
  readonly resultConversion?: RustValueConversion;
  readonly isAsync: boolean;
  readonly isFallible: boolean;
  readonly returnedFuture?: {
    readonly awaiting: "infallible" | "fallible";
    readonly errorBoundary: RustErrorBoundary;
    readonly errorCarrier?: TargetTypeRef;
  };
  readonly evaluation?: "pure";
  readonly errorBoundary?: RustFallibleErrorBoundary;
  readonly errorCarrier?: TargetTypeRef;
  readonly isUnsafe?: boolean;
}

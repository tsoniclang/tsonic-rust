import type { Node } from "@tsonic/tsts";
import type { RustOperationErrorBoundary } from "../../operations/error-boundary.js";
import type { RustFinalizedValueConversion } from "../operations/finalized-operation.js";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableValueAdapter } from "../callables/callable-adapters.js";

export interface RustObjectLiteralMethodAdapterFact {
  readonly implementations: readonly {
    readonly sourceCallable: Node;
    readonly typeParameterSubstitutions: readonly (readonly [string, TargetTypeRef])[];
    readonly parameters: readonly RustCallableParameterAbi[];
    readonly returnCarrier: TargetTypeRef;
  }[];
  readonly dispatches: readonly {
    readonly contractMethod: Node;
    readonly virtualSlot: string;
    readonly implementationIndex: number;
    readonly parameters: readonly RustCallableParameterAbi[];
    readonly returnCarrier: TargetTypeRef;
    readonly parameterAdapters: readonly RustCallableParameterAdapter[];
    readonly resultAdapter: RustCallableValueAdapter;
    readonly adapterFallible: boolean;
  }[];
}

export interface RustSourceCallEffectsFact {
  readonly invocation: "infallible" | "fallible";
  readonly awaiting: "not-applicable" | "infallible" | "fallible";
  readonly unionBranches?: readonly Pick<RustSourceCallEffectsFact, "invocation" | "awaiting">[];
  readonly nativeInput?: {
    readonly invocationError: TargetTypeRef;
    readonly invocationErrorSource: string;
    readonly awaitErrors: readonly TargetTypeRef[];
    readonly awaitErrorSources: readonly string[];
  };
}

export interface RustSourceAccessorEffectsFact {
  readonly read?: "infallible" | "fallible";
  readonly write?: "infallible" | "fallible";
}

export interface RustFutureValueFact {
  readonly outputCarrier: TargetTypeRef;
  readonly awaitedConversion: RustFinalizedValueConversion;
  readonly awaiting: "infallible" | "fallible";
  readonly errorBoundary: RustOperationErrorBoundary | "source-native";
  readonly errorCarrier?: TargetTypeRef;
  readonly errorSource?: string;
}

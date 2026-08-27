import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import type { Node } from "@tsonic/tsts";
import type { RustArgumentMode, RustValueConversion } from "../../target-model/operations/model.js";
import type { RustErrorBoundary } from "../../target-model/operations/error-boundary.js";
import type { RustFinalizedValueConversion } from "./finalized-operation-abi.js";
import type { RustPlanKey } from "../../target-model/facts/keys.js";
import type { RustSourceParameterAbiFact } from "./callables-and-resources.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export type RustObjectLiteralValueAdapter =
  | {
      readonly kind: "identity";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "conversion";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly conversion: RustValueConversion;
    }
  | {
      readonly kind: "project-upcast";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "call-scoped-lifetime";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
    }
  | {
      readonly kind: "option-some";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly element: RustObjectLiteralValueAdapter;
    }
  | {
      readonly kind: "option-map";
      readonly sourceCarrier: TargetTypeRef;
      readonly targetCarrier: TargetTypeRef;
      readonly element: RustObjectLiteralValueAdapter;
    };

export interface RustObjectLiteralMethodParameterAbi {
  readonly form: RustSourceParameterAbiFact["form"];
  readonly valueCarrier: TargetTypeRef;
  readonly parameterCarrier: TargetTypeRef;
  readonly mode: RustArgumentMode;
}

export type RustObjectLiteralMethodParameterAdapter =
  | {
      readonly kind: "runtime-value";
      readonly contractParameterIndex: number;
      readonly source: RustObjectLiteralMethodParameterAbi;
      readonly target: RustObjectLiteralMethodParameterAbi;
      readonly adapter: RustObjectLiteralValueAdapter;
    }
  | {
      readonly kind: "logical-value";
      readonly contractParameterIndex: number;
      readonly source: RustObjectLiteralMethodParameterAbi;
      readonly target: RustObjectLiteralMethodParameterAbi;
      readonly adapter: RustObjectLiteralValueAdapter;
    }
  | {
      readonly kind: "omitted";
      readonly target: RustObjectLiteralMethodParameterAbi;
    }
  | {
      readonly kind: "fixed-rest";
      readonly contractParameterIndexes: readonly number[];
      readonly sources: readonly RustObjectLiteralMethodParameterAbi[];
      readonly target: RustObjectLiteralMethodParameterAbi;
      readonly elementAdapters: readonly RustObjectLiteralValueAdapter[];
    }
  | {
      readonly kind: "sequence-rest";
      readonly contractParameterIndex: number;
      readonly source: RustObjectLiteralMethodParameterAbi;
      readonly target: RustObjectLiteralMethodParameterAbi;
      readonly elementAdapter: RustObjectLiteralValueAdapter;
    };

export interface RustObjectLiteralMethodAdapterFact {
  readonly implementations: readonly {
    readonly sourceCallable: Node;
    readonly typeParameterSubstitutions: readonly (readonly [string, TargetTypeRef])[];
    readonly parameters: readonly RustObjectLiteralMethodParameterAbi[];
    readonly returnCarrier: TargetTypeRef;
  }[];
  readonly dispatches: readonly {
    readonly contractMethod: Node;
    readonly virtualSlot: string;
    readonly implementationIndex: number;
    readonly parameters: readonly RustObjectLiteralMethodParameterAbi[];
    readonly returnCarrier: TargetTypeRef;
    readonly parameterAdapters: readonly RustObjectLiteralMethodParameterAdapter[];
    readonly resultAdapter: RustObjectLiteralValueAdapter;
    readonly adapterFallible: boolean;
  }[];
}

export const rustObjectLiteralMethodAdapterFactKey: RustPlanKey<RustObjectLiteralMethodAdapterFact> =
  defineRustPlanKey("objectLiteralMethodAdapter", objectLiteralMethodAdapterFactEquals);

function objectLiteralMethodAdapterFactEquals(
  left: RustObjectLiteralMethodAdapterFact,
  right: RustObjectLiteralMethodAdapterFact,
): boolean {
  return left.implementations.length === right.implementations.length &&
    left.implementations.every((implementation, index) => {
      const candidate = right.implementations[index];
      return candidate !== undefined && implementation.sourceCallable === candidate.sourceCallable &&
        closedMetadataEquals(
          {
            typeParameterSubstitutions: implementation.typeParameterSubstitutions,
            parameters: implementation.parameters,
            returnCarrier: implementation.returnCarrier,
          },
          {
            typeParameterSubstitutions: candidate.typeParameterSubstitutions,
            parameters: candidate.parameters,
            returnCarrier: candidate.returnCarrier,
          },
        );
    }) &&
    left.dispatches.length === right.dispatches.length &&
    left.dispatches.every((dispatch, index) => {
      const candidate = right.dispatches[index];
      return candidate !== undefined && dispatch.contractMethod === candidate.contractMethod &&
        closedMetadataEquals(
          {
            virtualSlot: dispatch.virtualSlot,
            implementationIndex: dispatch.implementationIndex,
            parameters: dispatch.parameters,
            returnCarrier: dispatch.returnCarrier,
            parameterAdapters: dispatch.parameterAdapters,
            resultAdapter: dispatch.resultAdapter,
            adapterFallible: dispatch.adapterFallible,
          },
          {
            virtualSlot: candidate.virtualSlot,
            implementationIndex: candidate.implementationIndex,
            parameters: candidate.parameters,
            returnCarrier: candidate.returnCarrier,
            parameterAdapters: candidate.parameterAdapters,
            resultAdapter: candidate.resultAdapter,
            adapterFallible: candidate.adapterFallible,
          },
        );
    });
}

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
  readonly errorBoundary: RustErrorBoundary;
  readonly errorCarrier?: TargetTypeRef;
}

// Exact await behavior for one first-class future value. Unlike its runtime
// carrier, this fact preserves operation-specific rejection and result-
// conversion semantics while the value flows through immutable bindings.
export const rustFutureValueFactKey: RustPlanKey<RustFutureValueFact> =
  defineRustPlanKey("futureValue", closedMetadataEquals);

import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../key.js";
import type { RustPlanKey } from "../key.js";
import type { RustObjectLiteralMethodAdapterFact, RustSourceCallEffectsFact, RustSourceAccessorEffectsFact, RustFutureValueFact } from "../../../../target-model/records/object-methods.js";

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

export const rustFallibleFactKey: RustPlanKey<{ readonly fallible: true }> =
  defineRustPlanKey("fallible", () => true);

export const rustSourceCallEffectsFactKey: RustPlanKey<RustSourceCallEffectsFact> =
  defineRustPlanKey("sourceCallEffects", closedMetadataEquals);

export const rustSourceAccessorEffectsFactKey: RustPlanKey<RustSourceAccessorEffectsFact> =
  defineRustPlanKey("sourceAccessorEffects", closedMetadataEquals);

export const rustFutureValueFactKey: RustPlanKey<RustFutureValueFact> =
  defineRustPlanKey("futureValue", closedMetadataEquals);

import { type RustTypeDefinitions } from "../../../../target-model/types/source-union-definitions.js";

import { finalizeRustProviderOperationAbi } from "../../../../policy/operations/members/abi/finalize.js";
import { rustIndexedLocationContract } from "../../../../policy/operations/members/abi/indexed-location.js";

import type { RustProviderOperationTemplate } from "../../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";

import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function finalizeProviderOperationFact(
  template: RustProviderOperationTemplate,
  sourceArgumentCarriers: readonly TargetTypeRef[],
  sourceReceiver: import("../../../../target-model/records/operations/finalized-operation.js").RustProviderSourceReceiver | undefined,
  definitions: RustTypeDefinitions,
  spreadSourceArgumentIndexes?: readonly number[],
  dispatchContextInputFor?: (input: unknown) =>
    import("../../../../target-model/operations/dispatch-contexts.js").RustResolvedDispatchContextInput | undefined,
): Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> | undefined {
  const dispatchInputs = (template.dispatchInputs ?? []).map(input => dispatchContextInputFor?.(input));
  if (dispatchInputs.some(input => input === undefined)) return undefined;
  const abi = finalizeRustProviderOperationAbi({
    operationKind: template.operationKind,
    form: template.target,
    ...(sourceReceiver === undefined ? {} : { sourceReceiver: sourceReceiver.kind === "runtime"
      ? { ...sourceReceiver, ...(template.receiverCarrier === undefined ? {} : { declaredCarrier: template.receiverCarrier }) }
      : sourceReceiver }),
    sourceArgumentCarriers,
    ...(spreadSourceArgumentIndexes === undefined ? {} : { spreadSourceArgumentIndexes }),
    declaredSourceArgumentCarriers: template.parameterCarriers,
    ...(template.evaluationOnlySourceArgumentIndexes === undefined
      ? {}
      : { evaluationOnlySourceArgumentIndexes: template.evaluationOnlySourceArgumentIndexes }),
    resultCarrier: template.resultCarrier,
    dispatchInputs: dispatchInputs.filter(input => input !== undefined),
    ...(Object.prototype.hasOwnProperty.call(template, "nativeErrorCarriers") ? { nativeErrorCarriers: template.nativeErrorCarriers } : {}),
    ...(template.targetGenericArguments === undefined
      ? {}
      : { targetGenericArguments: template.targetGenericArguments }),
    ...(template.resultConversion === undefined ? {} : { resultConversion: template.resultConversion }),
    isAsync: template.isAsync,
    isFallible: template.isFallible,
    ...(template.returnedFuture === undefined
      ? {}
      : { returnedFuture: template.returnedFuture }),
    ...(template.evaluation === undefined ? {} : { evaluation: template.evaluation }),
    ...(template.errorBoundary === "none" ? {} : { errorBoundary: template.errorBoundary }),
    ...(template.errorCarrier === undefined ? {} : { errorCarrier: template.errorCarrier }),
    isUnsafe: template.isUnsafe,
  }, definitions);
  if (abi === undefined) {
    return undefined;
  }
  const fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }> = {
    kind: "provider-operation",
    operationId: template.operationId,
    ...(template.indexedLocationMethod === undefined ? {} : { indexedLocationMethod: template.indexedLocationMethod }),
    ...(template.borrowedIndexOperation === undefined ? {} : {
      borrowedIndexOperation: Object.freeze({ ...template.borrowedIndexOperation }),
    }),
    ...(template.carrierRequirements === undefined ? {} : { carrierRequirements: template.carrierRequirements }),
    resultCarrier: abi.result.kind === "async" ? abi.result.futureCarrier : abi.result.carrier,
    ...(template.sourceResultCarrier === undefined
      ? {}
      : { sourceResultCarrier: template.sourceResultCarrier }),
    ...(template.sourceAbsenceCarrier === undefined
      ? {}
      : { sourceAbsenceCarrier: template.sourceAbsenceCarrier }),
    abi,
  };
  return fact.indexedLocationMethod !== undefined && rustIndexedLocationContract(fact, definitions) === undefined
    ? undefined
    : fact;
}

import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustPlanKey } from "../key.js";
import { rustLifetimesEqual } from "../../../../target-model/lifetimes/index.js";
import type { RustAsyncFunctionFact, RustGeneratorFact, RustSuspendedOwnedReceiver, RustSuspendedCallableStorage, RustYieldFact, RustSourceParameterAbiFact } from "../../../../target-model/records/callables-and-resources.js";

export const rustAsyncFunctionFactKey: RustPlanKey<RustAsyncFunctionFact> =
  defineRustPlanKey("asyncFunction", (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.futureCarrier, right.futureCarrier) &&
    rustTargetTypeRefEquals(left.outputCarrier, right.outputCarrier) &&
    (left.kind === "native-future" || right.kind === "native-future" ||
      left.capturedParameters.length === right.capturedParameters.length &&
      left.capturedParameters.every((parameter, index) =>
        parameter === right.capturedParameters[index]) &&
      suspendedCallableStorageEquals(left.storage, right.storage) &&
      suspendedOwnedReceiverEquals(left.ownedReceiver, right.ownedReceiver)));

export const rustGeneratorFactKey: RustPlanKey<RustGeneratorFact> =
  defineRustPlanKey("generator", (left, right) =>
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier) &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.returnType, right.returnType) &&
    rustTargetTypeRefEquals(left.nextType, right.nextType) &&
    left.capturedParameters.length === right.capturedParameters.length &&
    left.capturedParameters.every((parameter, index) =>
      parameter === right.capturedParameters[index]) &&
    left.storage.kind === right.storage.kind &&
    suspendedCallableStorageEquals(left.storage, right.storage) &&
    suspendedOwnedReceiverEquals(left.ownedReceiver, right.ownedReceiver));

function suspendedOwnedReceiverEquals(
  left: RustSuspendedOwnedReceiver | undefined,
  right: RustSuspendedOwnedReceiver | undefined,
): boolean {
  return left === undefined ? right === undefined : right !== undefined &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) &&
    left.occurrences.length === right.occurrences.length &&
    left.occurrences.every((node, index) => node === right.occurrences[index]);
}

function suspendedCallableStorageEquals(
  left: RustSuspendedCallableStorage,
  right: RustSuspendedCallableStorage,
): boolean {
  return left.kind === right.kind &&
    (left.kind !== "lifetime" ||
      right.kind === "lifetime" &&
      rustLifetimesEqual(left.lifetime, right.lifetime));
}

export const rustYieldFactKey: RustPlanKey<RustYieldFact> =
  defineRustPlanKey("yield", (left, right) =>
    left.generatorDeclaration === right.generatorDeclaration &&
    left.kind === right.kind &&
    rustTargetTypeRefEquals(left.yieldType, right.yieldType) &&
    rustTargetTypeRefEquals(left.resultType, right.resultType) &&
    (left.delegatedCarrier === undefined
      ? right.delegatedCarrier === undefined
      : right.delegatedCarrier !== undefined &&
        rustTargetTypeRefEquals(left.delegatedCarrier, right.delegatedCarrier)));

export const rustSourceParameterAbiFactKey: RustPlanKey<RustSourceParameterAbiFact> =
  defineRustPlanKey("sourceParameterAbi", closedMetadataEquals);

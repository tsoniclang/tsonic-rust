import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustPlanKey } from "../key.js";
import { rustSuspendedCallableStorageEquals, rustSuspendedOwnedReceiverEquals } from "../../../../target-model/records/equality.js";
import type { RustGeneratorFact, RustSourceParameterAbiFact } from "../../../../target-model/records/callables-and-resources.js";

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
    rustSuspendedCallableStorageEquals(left.storage, right.storage) &&
    rustSuspendedOwnedReceiverEquals(left.ownedReceiver, right.ownedReceiver));

export const rustSourceParameterAbiFactKey: RustPlanKey<RustSourceParameterAbiFact> =
  defineRustPlanKey("sourceParameterAbi", closedMetadataEquals);

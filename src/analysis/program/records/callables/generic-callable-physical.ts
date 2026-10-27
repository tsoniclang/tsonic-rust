import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustGenericCallableImplementation, RustGenericCallablePhysicalPlan, RustGenericCallablePhysicalRecordInput } from "../../../../target-model/records/callables/generic-callables.js";
import { closedMetadataKey } from "../../../../target-model/metadata/closed-data.js";

export function createRustGenericCallablePhysicalRecords(input: RustGenericCallablePhysicalRecordInput): RustGenericCallablePhysicalPlan {
  return Object.freeze({
    definitions: () => input.inventory,
    environmentFor: (implementation: RustGenericCallableImplementation) => input.environments.get(implementation),
    definitionFor: (carrier: TargetTypeRef) => input.selectedCarriers.get(closedMetadataKey(carrier))?.definition,
    argumentsFor: (carrier: TargetTypeRef) => input.selectedCarriers.get(closedMetadataKey(carrier))?.arguments,
    existingSelectionFor: (carrier: TargetTypeRef) => input.selectedCarriers.get(closedMetadataKey(carrier)),
    conversionFor: (source: TargetTypeRef, target: TargetTypeRef) => input.conversions.get(closedMetadataKey(source))?.get(closedMetadataKey(target)),
  });
}

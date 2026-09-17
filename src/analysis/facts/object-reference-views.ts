import type { TargetTypeRef } from "../../target-model/types/model.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustTargetOperationFact } from "./keys.js";

export interface RustObjectReferenceView {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly fields: readonly {
    readonly destinationIndex: number;
    readonly source: Omit<Extract<RustTargetOperationFact, {kind: "source-field"}>, "operationId" | "accessMode">;
    readonly writable: boolean;
  }[];
}

export const rustObjectReferenceViewKey = defineRustPlanKey<RustObjectReferenceView>("objectReferenceView", (left, right) =>
  rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
  rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier) &&
  left.fields.length === right.fields.length && left.fields.every((field, index) => {
    const other = right.fields[index]!;
    return field.destinationIndex === other.destinationIndex && field.writable === other.writable &&
      field.source.storage === other.source.storage && field.source.storageIndex === other.source.storageIndex &&
      field.source.declaration === other.source.declaration &&
      field.source.dispatch?.read === other.source.dispatch?.read && field.source.dispatch?.write === other.source.dispatch?.write &&
      rustTargetTypeRefEquals(field.source.dispatch?.ownerCarrier, other.source.dispatch?.ownerCarrier) &&
      rustTargetTypeRefEquals(field.source.resultCarrier, other.source.resultCarrier);
  }));

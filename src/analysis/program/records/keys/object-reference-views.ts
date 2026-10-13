import { defineRustPlanKey } from "../key.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustObjectReferenceView } from "../../../../target-model/records/object-reference-views.js";


export const rustObjectReferenceViewKey = defineRustPlanKey<RustObjectReferenceView>("objectReferenceView", (left, right) =>
  rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
  rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier) &&
  left.kind === right.kind && (left.kind !== "structural" && right.kind !== "structural"
    ? left.declaration === right.declaration
    : left.kind === "structural" && right.kind === "structural" &&
  left.fields.length === right.fields.length && left.fields.every((field, index) => {
    const other = right.fields[index]!;
    return field.destinationIndex === other.destinationIndex && field.writable === other.writable &&
      field.source.storage === other.source.storage && field.source.storageIndex === other.source.storageIndex &&
      field.source.declaration === other.source.declaration &&
      field.source.dispatch?.read === other.source.dispatch?.read && field.source.dispatch?.write === other.source.dispatch?.write &&
      rustTargetTypeRefEquals(field.source.dispatch?.ownerCarrier, other.source.dispatch?.ownerCarrier) &&
      rustTargetTypeRefEquals(field.source.resultCarrier, other.source.resultCarrier);
  })));

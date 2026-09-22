import type { TargetTypeRef } from "../../target-model/types/model.js";
import { defineRustPlanKey } from "../../target-model/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustTargetOperationFact } from "./keys.js";
import type { Node } from "@tsonic/tsts";

interface RustObjectReferenceViewCarriers {
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
}

export type RustObjectReferenceView = RustObjectReferenceViewCarriers & (
  | { readonly kind: "project"; readonly declaration: Node }
  | { readonly kind: "constructor"; readonly declaration: Node }
  | {
  readonly kind: "structural";
  readonly fields: readonly {
    readonly destinationIndex: number;
    readonly source: Omit<Extract<RustTargetOperationFact, {kind: "source-field"}>, "operationId" | "accessMode">;
    readonly writable: boolean;
  }[];
});

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

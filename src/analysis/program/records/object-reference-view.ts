import type { Node } from "@tsonic/tsts";
import type { RustObjectReferenceView } from "../../../target-model/records/object-reference-views.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustObjectReferenceView } from "../../expressions/object-reference-views.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

export interface RustObjectReferenceViewProducer {
  readonly records: RustRecordFamily<RustObjectReferenceView>;
  select(walk: RustFactWalk, expression: Node, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef): boolean;
}

export function createRustObjectReferenceViewProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustObjectReferenceView>,
): RustObjectReferenceViewProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.objectReferenceView", equals: objectReferenceViewEquals }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    select(walk: RustFactWalk, expression: Node, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef): boolean {
      assertOpen();
      const selected = selectRustObjectReferenceView(walk, expression, sourceCarrier, targetCarrier);
      if (selected === undefined) return false;
      family.writer.set(expression, selected);
      return true;
    },
  });
}

function objectReferenceViewEquals(left: RustObjectReferenceView, right: RustObjectReferenceView): boolean {
  return rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
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
        }));
}

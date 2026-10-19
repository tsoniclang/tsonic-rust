import type { Node } from "@tsonic/tsts";
import type { RustObjectReferenceView } from "../../../target-model/records/object-reference-views.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { createRustObjectReferenceViewQuery, rustObjectReferenceViewEquals } from "../../expressions/object-reference-views.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

export interface RustObjectReferenceViewProducer {
  readonly records: RustRecordFamily<RustObjectReferenceView>;
  select(walk: RustFactWalk, expression: Node, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef): RustObjectReferenceView | undefined;
}

export function createRustObjectReferenceViewProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustObjectReferenceView>,
): RustObjectReferenceViewProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.objectReferenceView", equals: rustObjectReferenceViewEquals }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    select: createRustObjectReferenceViewQuery({ assertOpen, records: family.reader,
      publish: (expression, view) => family.writer.set(expression, view) }),
  });
}

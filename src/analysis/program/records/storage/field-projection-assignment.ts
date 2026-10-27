import type { Node } from "@tsonic/tsts";
import type { RustFieldProjectionAssignment } from "../../../../target-model/records/storage/field-projection-assignment.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustFieldProjectionAssignmentProducer {
  readonly records: RustRecordFamily<RustFieldProjectionAssignment>;
  assignment(subject: Node, selection: RustFieldProjectionAssignment): void;
}

export function createRustFieldProjectionAssignmentProducer(assertOpen: () => void): RustFieldProjectionAssignmentProducer {
  const family = createRustRecordFamily<RustFieldProjectionAssignment>({ id: "tsonic.rust.fieldProjectionAssignment",
    equals: (left, right) => left.expression === right.expression && left.receiver === right.receiver && left.field === right.field }, assertOpen);
  return Object.freeze({ records: family.reader, assignment(subject: Node, selection: RustFieldProjectionAssignment): void {
    family.writer.set(subject, Object.freeze(selection));
  } });
}

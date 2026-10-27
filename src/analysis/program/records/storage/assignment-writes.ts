import type { Node } from "@tsonic/tsts";
import type { RustAssignmentWriteCompletion } from "../../../../target-model/records/storage/assignment-writes.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustAssignmentWriteProducer {
  readonly records: RustRecordFamily<RustAssignmentWriteCompletion>;
  assignment(subject: Node, completion: RustAssignmentWriteCompletion): void;
}

export function createRustAssignmentWriteProducer(assertOpen: () => void): RustAssignmentWriteProducer {
  const family = createRustRecordFamily<RustAssignmentWriteCompletion>({
    id: "tsonic.rust.assignmentWrite", equals: (left, right) => left === right,
  }, assertOpen);
  return Object.freeze({ records: family.reader,
    assignment(subject: Node, completion: RustAssignmentWriteCompletion): void {
      family.writer.set(subject, Object.freeze(completion));
    },
  });
}

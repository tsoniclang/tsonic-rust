import type { Node } from "@tsonic/tsts";
import type { RustAssignmentEvaluation } from "../../../../target-model/records/storage/assignment-evaluation.js";
import { createRustRecordFamily } from "../family.js";

export function createRustAssignmentEvaluationProducer(assertOpen: () => void) {
  const family = createRustRecordFamily<RustAssignmentEvaluation>({ id: "tsonic.rust.assignmentEvaluation", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ assignmentEvaluation: family.reader }),
    publish: (node: Node, value: RustAssignmentEvaluation): void => family.writer.set(node, Object.freeze(value)) });
}
export type RustAssignmentEvaluationProducer = ReturnType<typeof createRustAssignmentEvaluationProducer>;

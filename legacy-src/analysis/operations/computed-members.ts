import type { AstReader, Node } from "@tsonic/tsts";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import type { RustProgramRecordWriter } from "../program/records/model.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";

export function recordRustComputedCallEvaluation(
  ast: AstReader, records: RustProgramRecordWriter, requiredRecords: RustRequiredRecord[], source: ResolvedSourceCallInfo | undefined,
  callee: Node, evaluateReceiver: boolean,
): Node | undefined {
  records.assertOpen();
  const access = source?.sourceCalleeAccess;
  if (access?.kind !== "element" || access.expression !== callee) return undefined;
  requireRustRecord(requiredRecords, "computedMember", access.expression, "computed call", "recordRustComputedCallEvaluation");
  const evaluation = records.computedMembers.evaluate(ast, access.expression,
    access.receiver.expression, access.argument.expression, "read", evaluateReceiver);
  return evaluation.key;
}
